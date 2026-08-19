import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Solid-color cover with the title; skipped silently if ffmpeg drawtext is unavailable
export async function generateCover(coverPath: string, title: string): Promise<boolean> {
  const text = title.replace(/[\\':]/g, " ").slice(0, 80);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", "color=c=0x1f3a5f:s=600x900",
      "-vf", `drawtext=text='${text}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:font=Georgia`,
      "-frames:v", "1", coverPath,
    ], { timeout: 60_000 });
    return true;
  } catch {
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=0x1f3a5f:s=600x900", "-frames:v", "1", coverPath,
      ], { timeout: 60_000 });
      return true;
    } catch {
      return false;
    }
  }
}
