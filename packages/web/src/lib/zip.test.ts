import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Zip } from "./zip.ts";

const run = promisify(execFile);

// Built by the same tool the exporter uses, so this is interop rather than a round trip
// through assumptions this file already makes.
const PROSE = "the sentence being spoken, on the page it was printed on. ".repeat(40);
let dir = "";
let zip: Zip;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "p2af-zip-"));
  await mkdir(path.join(dir, "src", "p2af", "cues"), { recursive: true });
  await writeFile(path.join(dir, "src", "p2af", "book.json"), JSON.stringify({ format: "p2af/1", prose: PROSE }));
  await writeFile(path.join(dir, "src", "p2af", "cues", "ch000.json"), JSON.stringify({ cues: [{ t: [0, 10] }] }));
  await writeFile(path.join(dir, "src", "stored.bin"), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));

  const archive = path.join(dir, "book.p2af");
  const opts = { cwd: path.join(dir, "src") };
  await run("zip", ["-X", "-q", "-9", "-r", archive, "p2af"], opts);
  await run("zip", ["-X", "-q", "-0", archive, "stored.bin"], opts);
  // A trailing comment pushes the end-of-central-directory record off the end of the file
  await run("sh", ["-c", `printf 'a read-along container\n' | zip -q -z ${JSON.stringify(archive)}`], opts);

  zip = await Zip.open(new Blob([await readFile(archive)]));
});

afterAll(async () => {
  zip?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Zip", () => {
  it("lists every entry the writer put in", () => {
    expect(zip.names()).toEqual(
      expect.arrayContaining(["p2af/book.json", "p2af/cues/ch000.json", "stored.bin"]),
    );
    expect(zip.has("p2af/nothing.json")).toBe(false);
  });

  it("inflates a deflated entry", async () => {
    expect(await zip.json<{ format: string; prose: string }>("p2af/book.json")).toEqual({
      format: "p2af/1",
      prose: PROSE,
    });
  });

  it("hands back a stored entry as its own bytes", async () => {
    const bytes = await zip.bytes("stored.bin");
    expect(bytes.size).toBe(5);
    expect(await bytes.text()).toBe("%PDF-");
  });

  it("says which entry is missing rather than failing obscurely", async () => {
    await expect(zip.bytes("p2af/nothing.json")).rejects.toThrow(/nothing\.json is not in this archive/);
  });

  it("refuses something that is not an archive at all", async () => {
    await expect(Zip.open(new Blob(["not a zip, just some bytes"]))).rejects.toThrow(/Not a zip archive/);
  });
});
