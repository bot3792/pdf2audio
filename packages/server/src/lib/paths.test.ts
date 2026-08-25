import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";

import { scriptPath } from "./paths.ts";

// These eight names used to be spelled inside a path.resolve at each call site, where a typo
// showed up as a synthesis job failing minutes later. They are strings now, so check them here.
const SPAWNED = [
  "synthesize.py",
  "synthesize_bg_tts_mlx.py",
  "synthesize_mms_tts.py",
  "synthesize_kugel_tts.py",
  "synthesize_say_tts.py",
  "synthesize_pocket_tts.py",
  "embed_bge_m3.py",
  "page_geometry.py",
];

describe("scriptPath", () => {
  it.each(SPAWNED)("resolves %s to a file that exists", async (name) => {
    await expect(access(scriptPath(name))).resolves.toBeUndefined();
  });

  it("is absolute, so a worker's working directory cannot change what gets run", () => {
    expect(scriptPath("synthesize.py").startsWith("/")).toBe(true);
  });
});
