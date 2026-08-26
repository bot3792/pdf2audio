import { spawn } from "node:child_process";

// The bookkeeping behind every optional download: which are running, and why the last one failed.
// Model bundles and Pocket's per-language models had a copy each, which is how one of them gained
// a fix for spawn errors reporting as "exit ?" and the other kept reporting "exit ?".
export class DownloadTracker {
  private readonly inFlight = new Set<string>();
  private readonly failures = new Map<string, string>();

  get active(): number {
    return this.inFlight.size;
  }

  downloading(id: string): boolean {
    return this.inFlight.has(id);
  }

  error(id: string): string | null {
    return this.failures.get(id) ?? null;
  }

  // HF_HUB_OFFLINE is deliberately 0 here — this is the one path allowed to reach the network.
  start(id: string, bin: string, args: string[], onDone?: () => void): { started: boolean } {
    if (this.inFlight.has(id)) return { started: false };
    this.inFlight.add(id);
    this.failures.delete(id);

    const proc = spawn(bin, args, { env: { ...process.env, HF_HUB_OFFLINE: "0" } });
    let stderr = "";
    proc.stderr?.on("data", (buf) => { stderr = (stderr + String(buf)).slice(-2000); });

    // A failed spawn emits "error" and then "close" with an empty stderr, so without the guard the
    // useful message ("spawn …/python ENOENT") is overwritten by a generic "exit ?".
    let settled = false;
    const finish = (message: string | null) => {
      if (settled) return;
      settled = true;
      this.inFlight.delete(id);
      if (message) this.failures.set(id, message);
      onDone?.();
    };
    proc.on("close", (code) => finish(code === 0 ? null : stderr.trim().split("\n").at(-1) || `Download failed (exit ${code ?? "?"})`));
    proc.on("error", (err) => finish(err.message));

    return { started: true };
  }
}
