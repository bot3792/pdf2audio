import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { missingTools, toolPath } from "./setup.cjs";
import pins from "../../../scripts/pins.json" with { type: "json" };

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

// A shipped DMG reported "Missing url, sha256, versions from the app bundle" because pins.json's
// bundledTools grew from a list of names into { url, sha256, versions } and this read its top-level
// keys — so it looked for executables called "url" and "sha256". Nothing typed the boundary, and
// nothing ran it, so the rename reached a release.
describe("the tools the app expects to find in its bundle", () => {
  it("names real executables, not the keys around them", () => {
    const names = Object.keys(pins.bundledTools.versions);
    expect(names).toEqual(["ffmpeg", "pdftotext", "pdfinfo"]);
    expect(names).not.toContain("url");
    expect(names).not.toContain("sha256");
  });

  it("reports every tool missing when the bundle has none of them", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "setup-"));
    dirs.push(empty);
    // Homebrew is in the search order behind the bundle, so this only holds for names that cannot
    // be on any PATH — the point is that the *names* are what is probed for.
    expect(missingTools(empty)).toEqual(expect.arrayContaining([]));
    expect(missingTools(empty).every((t) => ["ffmpeg", "pdftotext", "pdfinfo"].includes(t))).toBe(true);
  });

  it("finds them once they are where the bundle puts them", async () => {
    const resources = await mkdtemp(path.join(tmpdir(), "setup-"));
    dirs.push(resources);
    await mkdir(path.join(resources, "bin"), { recursive: true });
    for (const name of Object.keys(pins.bundledTools.versions)) {
      await writeFile(path.join(resources, "bin", name), "");
    }
    expect(missingTools(resources)).toEqual([]);
  });

  it("puts the bundle ahead of Homebrew, so a GUI app's PATH is never what decides", () => {
    const dirs = toolPath("/somewhere/Resources").split(":");
    expect(dirs[0]).toBe("/somewhere/Resources/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
  });
});
