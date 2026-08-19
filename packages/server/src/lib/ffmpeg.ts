import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";

const execFileAsync = promisify(execFile);

// All chapter audio is pinned to one stream shape so assemblies can concat with -c copy
const AAC_ARGS = ["-b:a", "64k", "-ar", "44100", "-ac", "1"];

let aacEncoder: "aac_at" | "aac" | null = null;

// Apple's AudioToolbox encoder beats ffmpeg's built-in aac; only present in macOS builds
async function pickAacEncoder(): Promise<"aac_at" | "aac"> {
  if (!aacEncoder) {
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"]);
    aacEncoder = /\baac_at\b/.test(stdout) ? "aac_at" : "aac";
  }
  return aacEncoder;
}

export async function encodeToM4a(inputPath: string, m4aPath: string): Promise<void> {
  const encoder = await pickAacEncoder();
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-codec:a", encoder,
    ...AAC_ARGS,
    "-movflags", "+faststart",
    m4aPath,
  ], { timeout: 300_000 });
}

export type M4bChapter = {
  title: string;
  startMs: number;
  endMs: number;
};

export type M4bMeta = {
  title: string;
  artist: string;
  chapters: M4bChapter[];
  coverPath?: string;
};

function escapeFfmeta(value: string): string {
  return value.replace(/\s+/g, " ").replace(/([=;#\\])/g, "\\$1");
}

function buildFfmeta(meta: M4bMeta): string {
  const lines = [
    ";FFMETADATA1",
    `title=${escapeFfmeta(meta.title)}`,
    `artist=${escapeFfmeta(meta.artist)}`,
    "genre=Audiobook",
  ];
  for (const ch of meta.chapters) {
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${ch.startMs}`,
      `END=${ch.endMs}`,
      `title=${escapeFfmeta(ch.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}

// Inputs must all carry the AAC_ARGS stream shape — the audio is stitched without re-encoding
export async function concatToM4b(m4aPaths: string[], outputPath: string, meta: M4bMeta): Promise<void> {
  const listPath = outputPath + ".filelist.txt";
  const metaPath = outputPath + ".ffmeta";
  await writeFile(listPath, m4aPaths.map((f) => `file '${f}'`).join("\n"), "utf-8");
  await writeFile(metaPath, buildFfmeta(meta), "utf-8");

  const cover = meta.coverPath;
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-i", metaPath,
      ...(cover ? ["-i", cover] : []),
      "-map", "0:a",
      ...(cover ? ["-map", "2:v", "-codec:v", "copy", "-disposition:v:0", "attached_pic"] : []),
      "-map_metadata", "1",
      "-map_chapters", "1",
      "-codec:a", "copy",
      // stik atom: makes players file the result as an audiobook
      "-metadata", "media_type=2",
      "-movflags", "+faststart",
      "-f", "ipod",
      outputPath,
    ], { timeout: 600_000 });
  } finally {
    await unlink(listPath).catch(() => {});
    await unlink(metaPath).catch(() => {});
  }
}
