import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function wavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", wavPath,
    "-codec:a", "libmp3lame",
    "-qscale:a", "2",
    mp3Path,
  ], { timeout: 300_000 });
}

export async function concatMp3s(mp3Paths: string[], outputPath: string): Promise<void> {
  const listPath = outputPath + ".filelist.txt";
  const listContent = mp3Paths.map((f) => `file '${f}'`).join("\n");
  await writeFile(listPath, listContent, "utf-8");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outputPath,
  ], { timeout: 300_000 });
}
