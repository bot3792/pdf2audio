import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CLI_CANDIDATES, SOCKET_CANDIDATES, dockerAdvice, findDockerCli, findDockerSocket } from "./docker.ts";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "docker-probe-"));
  dirs.push(d);
  return d;
}

describe("finding Docker without $PATH", () => {
  // A GUI app gets /usr/bin:/bin:/usr/sbin:/sbin, so `which docker` finds nothing on a machine
  // that is running Docker fine. Every real install location has to be listed instead.
  it("covers Docker Desktop, OrbStack, Homebrew and /usr/local", () => {
    expect(CLI_CANDIDATES).toEqual(expect.arrayContaining([
      "/usr/local/bin/docker",
      "/opt/homebrew/bin/docker",
      "/Applications/Docker.app/Contents/Resources/bin/docker",
      "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
    ]));
  });

  it("looks for OrbStack's and Colima's sockets, not only /var/run", () => {
    expect(SOCKET_CANDIDATES[0]).toBe("/var/run/docker.sock");
    expect(SOCKET_CANDIDATES.some((s) => s.includes(".orbstack"))).toBe(true);
    expect(SOCKET_CANDIDATES.some((s) => s.includes(".colima"))).toBe(true);
  });

  it("returns the first candidate that exists, in order", async () => {
    const dir = await scratch();
    const second = path.join(dir, "second");
    await writeFile(second, "");
    expect(await findDockerCli([path.join(dir, "first"), second])).toBe(second);
  });

  it("returns null when none exist rather than guessing", async () => {
    const dir = await scratch();
    expect(await findDockerCli([path.join(dir, "nope")])).toBeNull();
    expect(await findDockerSocket([path.join(dir, "nope.sock")])).toBeNull();
  });
});

describe("dockerAdvice", () => {
  it("tells someone with Docker stopped to start it, not to install it", () => {
    expect(dockerAdvice({ kind: "installed-not-running", cli: "/usr/local/bin/docker" })).toMatch(/start it/i);
  });

  it("tells someone without Docker where to get it", () => {
    expect(dockerAdvice({ kind: "missing" })).toMatch(/OrbStack/);
  });
});
