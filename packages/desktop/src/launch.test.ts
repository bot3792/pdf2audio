import { describe, expect, it } from "vitest";

import { dockerStep, preflight, waitForServer } from "./launch.ts";

describe("dockerStep", () => {
  it("blocks, rather than fails, when Docker is missing", () => {
    const step = dockerStep({ kind: "missing" });
    expect(step.state).toBe("blocked");
    expect(step.detail).toMatch(/Install Docker/i);
  });

  it("distinguishes stopped from absent, because the fix is different", () => {
    expect(dockerStep({ kind: "installed-not-running", cli: "/x" }).detail).toMatch(/start it/i);
  });

  it("passes when the daemon answers", () => {
    expect(dockerStep({ kind: "ready", cli: "/x", version: "29.4.0" }).state).toBe("done");
  });
});

describe("preflight", () => {
  // Nothing after Docker can run without it, and a list of "pending" steps that will never start
  // reads as though the app is working
  it("marks every later step blocked when Docker is not ready", async () => {
    const steps = await preflight();
    const docker = steps[0];
    if (docker.state === "done") {
      expect(steps.slice(1).every((s) => s.state === "pending")).toBe(true);
    } else {
      expect(steps.slice(1).every((s) => s.state === "blocked")).toBe(true);
    }
  });

  it("always reports the five steps in order", async () => {
    expect((await preflight()).map((s) => s.id)).toEqual(["docker", "database", "python", "voice", "server"]);
  });
});

describe("waitForServer", () => {
  it("gives up rather than hanging when nothing ever answers", async () => {
    let t = 0;
    const ok = await waitForServer("http://127.0.0.1:1", 1200, () => (t += 600));
    expect(ok).toBe(false);
  });
});
