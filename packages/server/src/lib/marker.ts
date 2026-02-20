import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const CONDA_BIN = process.env.CONDA_ENV_PATH ?? "/Users/petur/miniconda3/envs/pdf2audio/bin";

type MarkerBlock = {
  id: string;
  block_type: string;
  html: string;
  children: MarkerBlock[] | null;
  section_hierarchy: Record<string, string> | null;
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

export type ExtractedChapter = {
  title: string;
  text: string;
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

function collectTextBlocks(block: MarkerBlock, out: { type: string; text: string; hierarchy: Record<string, string> | null }[]) {
  if (block.children) {
    for (const child of block.children) {
      collectTextBlocks(child, out);
    }
  } else if (KEEP_BLOCK_TYPES.has(block.block_type)) {
    const text = stripHtml(block.html);
    if (text) {
      out.push({
        type: block.block_type,
        text,
        hierarchy: block.section_hierarchy,
      });
    }
  }
}

function extractHeadingLevel(html: string): number | null {
  const match = html.match(/<h(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

function detectChaptersFromBlocks(allBlocks: { type: string; text: string; hierarchy: Record<string, string> | null; level?: number }[]): ExtractedChapter[] {
  const headingBlocks: { index: number; level: number; text: string }[] = [];
  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].type === "SectionHeader") {
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
    return splitByWordCount(allBlocks.map((b) => b.text).join("\n\n"));
  }

  const chapterHeadings = headingBlocks.filter((h) => h.level === targetLevel);
  if (chapterHeadings.length === 0) {
    return splitByWordCount(allBlocks.map((b) => b.text).join("\n\n"));
  }

  const chapters: ExtractedChapter[] = [];
  for (let i = 0; i < chapterHeadings.length; i++) {
    const start = chapterHeadings[i].index;
    const end = i + 1 < chapterHeadings.length ? chapterHeadings[i + 1].index : allBlocks.length;
    const chapterBlocks = allBlocks.slice(start + 1, end);
    const text = chapterBlocks.map((b) => b.text).join("\n\n");
    if (text.trim()) {
      chapters.push({ title: chapterHeadings[i].text, text });
    }
  }

  const preface = allBlocks.slice(0, chapterHeadings[0].index);
  if (preface.length > 0) {
    const prefaceText = preface.map((b) => b.text).join("\n\n");
    if (prefaceText.trim().split(/\s+/).length > 50) {
      chapters.unshift({ title: "Preface", text: prefaceText });
    }
  }

  return chapters;
}

function splitByWordCount(fullText: string, wordsPerChapter = 5000): ExtractedChapter[] {
  const words = fullText.split(/\s+/);
  if (words.length <= wordsPerChapter) {
    return [{ title: "Full Text", text: fullText }];
  }

  const chapters: ExtractedChapter[] = [];
  let partNum = 1;
  for (let i = 0; i < words.length; i += wordsPerChapter) {
    const chunk = words.slice(i, i + wordsPerChapter).join(" ");
    chapters.push({ title: `Part ${partNum}`, text: chunk });
    partNum++;
  }
  return chapters;
}

type LogFn = (message: string) => Promise<void>;

const noopLog: LogFn = async () => {};

export async function extractPdf(pdfPath: string, outDir: string, log: LogFn = noopLog): Promise<ExtractedChapter[]> {
  await mkdir(outDir, { recursive: true });

  await log(`Running marker_single on "${path.basename(pdfPath)}"`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      path.join(CONDA_BIN, "marker_single"),
      [pdfPath, "--output_format", "json", "--output_dir", outDir],
      { env: { ...process.env, TORCH_DEVICE: "mps", PATH: `${CONDA_BIN}:${process.env.PATH}` } }
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("marker_single timed out after 10 minutes"));
    }, 600_000);

    const rl = createInterface({ input: proc.stderr });
    rl.on("line", (line) => {
      const progressMatch = line.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        const [, current, total] = progressMatch;
        log(`${line.trim().split(":")[0]?.trim() || "Processing"}: ${current}/${total}`);
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

  const allBlocks: { type: string; text: string; hierarchy: Record<string, string> | null; level?: number }[] = [];

  for (const page of doc.children) {
    if (page.block_type !== "Page" || !page.children) continue;
    for (const block of page.children) {
      if (block.children) {
        const nested: { type: string; text: string; hierarchy: Record<string, string> | null }[] = [];
        collectTextBlocks(block, nested);
        for (const n of nested) {
          allBlocks.push(n);
        }
      } else if (KEEP_BLOCK_TYPES.has(block.block_type)) {
        const text = stripHtml(block.html);
        if (text) {
          const level = block.block_type === "SectionHeader" ? extractHeadingLevel(block.html) : undefined;
          allBlocks.push({ type: block.block_type, text, hierarchy: block.section_hierarchy, level: level ?? undefined });
        }
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
