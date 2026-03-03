import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../env.ts";

const CONDA_BIN = env.CONDA_ENV_PATH;

type MarkerBlock = {
  id: string;
  block_type: string;
  html: string;
  children: MarkerBlock[] | null;
  section_hierarchy: Record<string, string> | null;
  polygon?: number[][];
};

type MarkerTocEntry = {
  title: string;
  heading_level: number;
  page_id: number;
};

type MarkerOutput = {
  children: MarkerBlock[];
  block_type: "Document";
  metadata?: {
    table_of_contents: MarkerTocEntry[];
  };
};

export type SourceBlock = {
  type: string;
  text: string;
  page: number;
  included: boolean;
  level?: number;
  polygon?: number[][];
};

export type ExtractedChapter = {
  title: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  sourceBlocks: SourceBlock[];
};

const KEEP_BLOCK_TYPES = new Set([
  "Text",
  "SectionHeader",
  "ListItem",
  "Handwriting",
]);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

type FlatBlock = {
  type: string;
  text: string;
  hierarchy: Record<string, string> | null;
  level?: number;
  page: number;
  polygon?: number[][];
  included: boolean;
};

function collectAllBlocks(block: MarkerBlock, page: number, out: FlatBlock[]) {
  if (block.children) {
    for (const child of block.children) {
      collectAllBlocks(child, page, out);
    }
  } else {
    const text = stripHtml(block.html);
    if (!text) return;
    const included = KEEP_BLOCK_TYPES.has(block.block_type);
    const level = block.block_type === "SectionHeader" ? (extractHeadingLevel(block.html) ?? undefined) : undefined;
    out.push({
      type: block.block_type,
      text,
      hierarchy: block.section_hierarchy,
      level,
      page,
      polygon: block.polygon,
      included,
    });
  }
}

function extractHeadingLevel(html: string): number | null {
  const match = html.match(/<h(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

function blocksToSourceBlocks(blocks: FlatBlock[]): SourceBlock[] {
  return blocks.map((b) => ({
    type: b.type,
    text: b.text,
    page: b.page,
    included: b.included,
    ...(b.level !== undefined ? { level: b.level } : {}),
    ...(b.polygon ? { polygon: b.polygon } : {}),
  }));
}

function chapterFromBlocks(title: string, blocks: FlatBlock[]): ExtractedChapter {
  const includedBlocks = blocks.filter((b) => b.included);
  const text = includedBlocks.map((b) => b.text).join("\n\n");
  const allPages = blocks.map((b) => b.page);
  const pageStart = allPages.length > 0 ? Math.min(...allPages) : null;
  const pageEnd = allPages.length > 0 ? Math.max(...allPages) : null;
  return { title, text, pageStart, pageEnd, sourceBlocks: blocksToSourceBlocks(blocks) };
}

function detectChaptersFromBlocks(allBlocks: FlatBlock[]): ExtractedChapter[] {
  const includedBlocks = allBlocks.filter((b) => b.included);
  const headingBlocks: { index: number; level: number; text: string }[] = [];
  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].included && allBlocks[i].type === "SectionHeader") {
      headingBlocks.push({ index: i, level: allBlocks[i].level ?? 1, text: allBlocks[i].text });
    }
  }

  let targetLevel: number | null = null;
  for (const lvl of [1, 2, 3]) {
    if (headingBlocks.some((h) => h.level === lvl)) {
      targetLevel = lvl;
      break;
    }
  }

  if (targetLevel === null) {
    return splitByWordCount(allBlocks);
  }

  const chapterHeadings = headingBlocks.filter((h) => h.level === targetLevel);
  if (chapterHeadings.length === 0) {
    return splitByWordCount(allBlocks);
  }

  const chapters: ExtractedChapter[] = [];
  for (let i = 0; i < chapterHeadings.length; i++) {
    const start = chapterHeadings[i].index;
    const end = i + 1 < chapterHeadings.length ? chapterHeadings[i + 1].index : allBlocks.length;
    const blocks = allBlocks.slice(start, end);
    const ch = chapterFromBlocks(chapterHeadings[i].text, blocks);
    if (ch.text.trim()) {
      chapters.push(ch);
    }
  }

  const prefaceBlocks = allBlocks.slice(0, chapterHeadings[0].index);
  if (prefaceBlocks.length > 0) {
    const ch = chapterFromBlocks("Preface", prefaceBlocks);
    if (ch.text.trim().split(/\s+/).length > 50) {
      chapters.unshift(ch);
    }
  }

  return chapters;
}

function splitByWordCount(allBlocks: FlatBlock[], wordsPerChapter = 5000): ExtractedChapter[] {
  const includedBlocks = allBlocks.filter((b) => b.included);
  const totalWords = includedBlocks.reduce((sum, b) => sum + b.text.split(/\s+/).filter(Boolean).length, 0);

  if (totalWords <= wordsPerChapter) {
    return [chapterFromBlocks("Full Text", allBlocks)];
  }

  const chapters: ExtractedChapter[] = [];
  let partNum = 1;
  let currentBlocks: FlatBlock[] = [];
  let currentWords = 0;

  for (const block of allBlocks) {
    currentBlocks.push(block);
    if (block.included) {
      currentWords += block.text.split(/\s+/).filter(Boolean).length;
    }
    if (currentWords >= wordsPerChapter) {
      chapters.push(chapterFromBlocks(`Part ${partNum}`, currentBlocks));
      partNum++;
      currentBlocks = [];
      currentWords = 0;
    }
  }

  if (currentBlocks.length > 0) {
    chapters.push(chapterFromBlocks(`Part ${partNum}`, currentBlocks));
  }

  return chapters;
}

type LogFn = (message: string) => Promise<void>;

const noopLog: LogFn = async () => {};

function runMarkerSingle(pdfPath: string, outDir: string, device: "mps" | "cpu", log: LogFn): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(
      path.join(CONDA_BIN, "marker_single"),
      [pdfPath, "--output_format", "json", "--output_dir", outDir],
      { env: { ...process.env, TORCH_DEVICE: device, HF_HUB_OFFLINE: "1", PATH: `${CONDA_BIN}:${process.env.PATH}` } }
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("marker_single timed out after 24 hours"));
    }, 86_400_000);

    let lastStage = "";
    let lastLoggedPercent = -1;
    let lastLogTime = Date.now();
    const rl = createInterface({ input: proc.stderr });
    rl.on("line", (line) => {
      const progressMatch = line.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        const [, currentStr, totalStr] = progressMatch;
        const current = Number(currentStr);
        const total = Number(totalStr);
        const stage = line.trim().split(":")[0]?.trim() || "Processing";
        const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
        const isNewStage = stage !== lastStage;
        const isSignificantProgress = percent >= lastLoggedPercent + 1;
        const isComplete = current === total;
        const isSilenceTooLong = Date.now() - lastLogTime >= 30_000;

        if (isNewStage || isSignificantProgress || isComplete || isSilenceTooLong) {
          log(`${stage}: ${currentStr}/${totalStr}`);
          lastStage = stage;
          lastLoggedPercent = percent;
          lastLogTime = Date.now();
        }
        if (isNewStage) lastLoggedPercent = percent;
      } else if (line.includes("WARNING") || line.includes("Error") || line.includes("Traceback")) {
        log(line.trim());
      }
    });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      rl.close();
      if (code !== 0) {
        reject(new Error(`marker_single exited with code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      rl.close();
      reject(err);
    });
  });
}

export async function extractPdf(pdfPath: string, outDir: string, log: LogFn = noopLog): Promise<ExtractedChapter[]> {
  await mkdir(outDir, { recursive: true });

  await log(`Running marker_single on "${path.basename(pdfPath)}"`);

  try {
    await runMarkerSingle(pdfPath, outDir, "mps", log);
  } catch (mpsError) {
    await log(`MPS extraction failed — known PyTorch MPS bug with certain PDFs. Retrying with CPU...`);
    await runMarkerSingle(pdfPath, outDir, "cpu", log);
  }

  let searchDir = outDir;
  let files = await readdir(outDir);
  let jsonFile = files.find((f) => f.endsWith(".json") && !f.endsWith("_meta.json"));

  if (!jsonFile) {
    for (const entry of files) {
      const entryPath = path.join(outDir, entry);
      const s = await stat(entryPath);
      if (s.isDirectory()) {
        const subFiles = await readdir(entryPath);
        const found = subFiles.find((f) => f.endsWith(".json") && !f.endsWith("_meta.json"));
        if (found) {
          searchDir = entryPath;
          jsonFile = found;
          break;
        }
      }
    }
  }

  if (!jsonFile) {
    throw new Error("Marker did not produce a JSON output file");
  }

  const raw = await readFile(path.join(searchDir, jsonFile), "utf-8");
  const doc: MarkerOutput = JSON.parse(raw);

  const allBlocks: FlatBlock[] = [];

  for (let pageIdx = 0; pageIdx < doc.children.length; pageIdx++) {
    const page = doc.children[pageIdx];
    if (page.block_type !== "Page" || !page.children) continue;
    const pageNum = pageIdx + 1;
    for (const block of page.children) {
      if (block.children) {
        collectAllBlocks(block, pageNum, allBlocks);
      } else {
        const text = stripHtml(block.html);
        if (!text) continue;
        const included = KEEP_BLOCK_TYPES.has(block.block_type);
        const level = block.block_type === "SectionHeader" ? (extractHeadingLevel(block.html) ?? undefined) : undefined;
        allBlocks.push({
          type: block.block_type,
          text,
          hierarchy: block.section_hierarchy,
          level,
          page: pageNum,
          polygon: block.polygon,
          included,
        });
      }
    }
  }

  const toc = doc.metadata?.table_of_contents;
  if (toc && toc.length > 0) {
    const h1Entries = toc.filter((e) => e.heading_level === 1);
    if (h1Entries.length >= 2) {
      return detectChaptersFromBlocks(allBlocks);
    }
  }

  return detectChaptersFromBlocks(allBlocks);
}
