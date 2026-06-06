import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { env } from "../env.ts";
import { detectChaptersWithLlm } from "./chapter-detect.ts";

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

function isLikelySubheading(text: string): boolean {
  const t = text.trim();
  if (/^(?:[A-Za-z]|\d+|[IVXivxlcdm]+)\.\s/.test(t)) return true;
  if (/^[a-z]{1,3}\s+[a-z]\.\s/.test(t)) return true;
  return false;
}

function isLikelyFrontOrBackMatter(text: string): boolean {
  const t = text.toLowerCase();
  return [
    "acknowledg",
    "about the author",
    "introduction",
    "preface",
    "table of contents",
    "contents",
    "bibliography",
    "index",
    "glossary",
  ].some((x) => t.includes(x));
}

function pickChapterHeadingIndices(allBlocks: FlatBlock[]): number[] {
  const headingBlocks: { index: number; level: number; text: string; page: number }[] = [];
  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].included && allBlocks[i].type === "SectionHeader") {
      headingBlocks.push({
        index: i,
        level: allBlocks[i].level ?? 4,
        text: allBlocks[i].text,
        page: allBlocks[i].page,
      });
    }
  }

  if (headingBlocks.length === 0) return [];

  const totalPages = Math.max(...allBlocks.map((b) => b.page));
  const minChapterPage = totalPages > 80 ? Math.floor(totalPages * 0.08) : 1;

  let bestIndices: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const level of [1, 2, 3, 4]) {
    const levelHeadings = headingBlocks.filter((h) => h.level === level);
    if (levelHeadings.length < 2) continue;

    const filtered = levelHeadings.filter((h) => {
      const words = h.text.split(/\s+/).filter(Boolean).length;
      if (h.page < minChapterPage) return false;
      if (words < 3) return false;
      if (isLikelySubheading(h.text)) return false;
      if (isLikelyFrontOrBackMatter(h.text)) return false;
      return true;
    });

    if (filtered.length < 2) continue;

    const count = filtered.length;
    const target = 10;
    const score = -Math.abs(count - target) + (level === 1 ? 0.5 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndices = filtered.map((h) => h.index);
    }
  }

  return bestIndices;
}

function detectChaptersFromBlocks(allBlocks: FlatBlock[]): ExtractedChapter[] {
  const chapterHeadingIndices = pickChapterHeadingIndices(allBlocks);
  if (chapterHeadingIndices.length < 2) {
    return splitByWordCount(allBlocks);
  }

  const chapters: ExtractedChapter[] = [];
  for (let i = 0; i < chapterHeadingIndices.length; i++) {
    const start = chapterHeadingIndices[i];
    const end = i + 1 < chapterHeadingIndices.length ? chapterHeadingIndices[i + 1] : allBlocks.length;
    const blocks = allBlocks.slice(start, end);
    const ch = chapterFromBlocks(allBlocks[start].text, blocks);
    if (ch.text.trim()) {
      chapters.push(ch);
    }
  }

  const prefaceBlocks = allBlocks.slice(0, chapterHeadingIndices[0]);
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

function similarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  const shorter = la.length < lb.length ? la : lb;
  const longer = la.length < lb.length ? lb : la;
  if (longer.length === 0) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  let matches = 0;
  const longerChars = [...longer];
  for (const ch of shorter) {
    const idx = longerChars.indexOf(ch);
    if (idx !== -1) {
      matches++;
      longerChars[idx] = "";
    }
  }
  return matches / longer.length;
}

function chaptersFromLlmBoundaries(
  allBlocks: FlatBlock[],
  boundaries: { title: string; page: number }[]
): ExtractedChapter[] | null {
  const blockIndices: number[] = [];

  for (const boundary of boundaries) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < allBlocks.length; i++) {
      const block = allBlocks[i];
      if (block.type !== "SectionHeader" || !block.included) continue;
      const pageDist = Math.abs(block.page - boundary.page);
      if (pageDist > 3) continue;
      const sim = similarity(block.text, boundary.title);
      const score = sim - pageDist * 0.1;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex !== -1 && bestScore > 0.3) {
      blockIndices.push(bestIndex);
    }
  }

  if (blockIndices.length < 2) return null;

  blockIndices.sort((a, b) => a - b);

  const chapters: ExtractedChapter[] = [];
  for (let i = 0; i < blockIndices.length; i++) {
    const start = blockIndices[i];
    const end = i + 1 < blockIndices.length ? blockIndices[i + 1] : allBlocks.length;
    const blocks = allBlocks.slice(start, end);
    const title = allBlocks[start].text;
    const ch = chapterFromBlocks(title, blocks);
    if (ch.text.trim()) {
      chapters.push(ch);
    }
  }

  const prefaceBlocks = allBlocks.slice(0, blockIndices[0]);
  if (prefaceBlocks.length > 0) {
    const ch = chapterFromBlocks("Preface", prefaceBlocks);
    if (ch.text.trim().split(/\s+/).length > 50) {
      chapters.unshift(ch);
    }
  }

  return chapters.length >= 2 ? chapters : null;
}

type LogFn = (message: string) => Promise<void>;

const noopLog: LogFn = async () => {};

function runMarkerSingle(pdfPath: string, outDir: string, device: "mps" | "cpu", log: LogFn, disableOcr: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = [pdfPath, "--output_format", "json", "--output_dir", outDir];
    if (disableOcr) args.push("--disable_ocr");
    const proc = spawn(
      path.join(CONDA_BIN, "marker_single"),
      args,
      { env: { ...process.env, TORCH_DEVICE: device, HF_HUB_OFFLINE: "1", OMP_NUM_THREADS: String(os.availableParallelism()), MKL_NUM_THREADS: String(os.availableParallelism()), PATH: `${CONDA_BIN}:${process.env.PATH}` } }
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

export type ExtractOptions = {
  forceOcr?: boolean;
  llmChapterDetection?: boolean;
};

async function findMarkerJson(outDir: string): Promise<string> {
  let searchDir = outDir;
  const files = await readdir(outDir);
  let jsonFile = files.find((f) => f.endsWith(".json") && !f.endsWith("_meta.json"));

  if (!jsonFile) {
    for (const entry of files) {
      const entryPath = path.join(outDir, entry);
      const s = await stat(entryPath);
      if (!s.isDirectory()) continue;
      const subFiles = await readdir(entryPath);
      const found = subFiles.find((f) => f.endsWith(".json") && !f.endsWith("_meta.json"));
      if (!found) continue;
      searchDir = entryPath;
      jsonFile = found;
      break;
    }
  }

  if (!jsonFile) {
    throw new Error("Marker did not produce a JSON output file");
  }

  return path.join(searchDir, jsonFile);
}

async function detectChaptersFromMarkerJsonPath(markerJsonPath: string, pdfPath: string, log: LogFn, options: ExtractOptions): Promise<ExtractedChapter[]> {
  const raw = await readFile(markerJsonPath, "utf-8");
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

  if (options.llmChapterDetection !== false) {
    await log("Attempting LLM chapter detection...");
    try {
      const boundaries = await detectChaptersWithLlm(markerJsonPath, pdfPath, log);
      if (boundaries && boundaries.length >= 2) {
        const chapters = chaptersFromLlmBoundaries(allBlocks, boundaries);
        if (chapters) {
          await log(`LLM detected ${chapters.length} chapters`);
          return chapters;
        }
        await log("LLM boundaries didn't match blocks, falling back to heuristic");
      } else {
        await log("LLM returned no usable chapters, falling back to heuristic");
      }
    } catch (err) {
      await log(`LLM chapter detection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (options.llmChapterDetection === false) {
    await log("LLM chapter detection disabled, using heuristic");
  }

  return detectChaptersFromBlocks(allBlocks);
}

export async function extractPdf(pdfPath: string, outDir: string, log: LogFn = noopLog, options: ExtractOptions = {}): Promise<ExtractedChapter[]> {
  await mkdir(outDir, { recursive: true });

  const disableOcr = !options.forceOcr;
  await log(`Running marker_single on "${path.basename(pdfPath)}"${disableOcr ? " (OCR disabled)" : " (OCR enabled)"}`);

  try {
    await runMarkerSingle(pdfPath, outDir, "mps", log, disableOcr);
  } catch (mpsError) {
    await log(`MPS extraction failed — known PyTorch MPS bug with certain PDFs. Retrying with CPU...`);
    await runMarkerSingle(pdfPath, outDir, "cpu", log, disableOcr);
  }

  const markerJsonPath = await findMarkerJson(outDir);
  return detectChaptersFromMarkerJsonPath(markerJsonPath, pdfPath, log, options);
}

export async function redetectChaptersFromExistingMarkerOutput(outDir: string, pdfPath: string, log: LogFn = noopLog, options: ExtractOptions = {}): Promise<ExtractedChapter[]> {
  const markerJsonPath = await findMarkerJson(outDir);
  await log("Re-detecting chapters from existing Marker output");
  return detectChaptersFromMarkerJsonPath(markerJsonPath, pdfPath, log, options);
}
