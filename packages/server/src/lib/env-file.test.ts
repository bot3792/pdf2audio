import { describe, it, expect } from "vitest";
import { applyEnvEdit } from "./env-file.ts";

const FILE = "DATABASE_URL=postgres://x\n# comment\nDEEPSEEK_API_KEY=old\nDATA_DIR=./data\n";

describe("applyEnvEdit", () => {
  it("replaces an existing key in place", () => {
    expect(applyEnvEdit(FILE, "DEEPSEEK_API_KEY", "new")).toBe(
      "DATABASE_URL=postgres://x\n# comment\nDEEPSEEK_API_KEY=new\nDATA_DIR=./data\n",
    );
  });

  it("removes a key without touching other lines", () => {
    expect(applyEnvEdit(FILE, "DEEPSEEK_API_KEY", null)).toBe(
      "DATABASE_URL=postgres://x\n# comment\nDATA_DIR=./data\n",
    );
  });

  it("appends a missing key with a trailing newline", () => {
    expect(applyEnvEdit(FILE, "OPENAI_API_KEY", "sk-1")).toBe(FILE + "OPENAI_API_KEY=sk-1\n");
  });

  it("does not match commented or prefixed keys", () => {
    const content = "# OPENAI_API_KEY=commented\nNOT_OPENAI_API_KEY=other\n";
    expect(applyEnvEdit(content, "OPENAI_API_KEY", "sk-2")).toBe(content + "OPENAI_API_KEY=sk-2\n");
  });

  it("collapses duplicate active lines into one", () => {
    expect(applyEnvEdit("A=1\nA=2\nB=3\n", "A", "9")).toBe("A=9\nB=3\n");
  });

  it("removing a missing key is a no-op", () => {
    expect(applyEnvEdit(FILE, "OPENAI_API_KEY", null)).toBe(FILE);
  });

  it("handles an empty file", () => {
    expect(applyEnvEdit("", "A", "1")).toBe("A=1\n");
  });
});
