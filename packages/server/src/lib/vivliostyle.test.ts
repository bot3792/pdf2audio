import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { rendererInstalled } from "./vivliostyle.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "viv-cache-"));
  dirs.push(dir);
  return dir;
}

describe("rendererInstalled", () => {
  it("is false when the browser cache does not exist", async () => {
    expect(await rendererInstalled(path.join(await scratch(), "never-created"))).toBe(false);
  });

  // Vivliostyle creates the directory before it finishes downloading, so its presence alone
  // would report a renderer that cannot render yet
  it("is false when the cache exists but is empty", async () => {
    const dir = path.join(await scratch(), "chrome");
    await mkdir(dir, { recursive: true });
    expect(await rendererInstalled(dir)).toBe(false);
  });

  it("is true once a build is in there", async () => {
    const dir = path.join(await scratch(), "chrome");
    await mkdir(path.join(dir, "mac_arm-150.0.7871.115"), { recursive: true });
    await writeFile(path.join(dir, "mac_arm-150.0.7871.115", "marker"), "");
    expect(await rendererInstalled(dir)).toBe(true);
  });
});
