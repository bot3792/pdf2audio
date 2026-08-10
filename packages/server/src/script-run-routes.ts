import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { env } from "./env.ts";

const paramsSchema = z.object({
  date: z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/).optional(),
  count: z.coerce.number().int().min(1).max(30).default(10),
  synthesize: z.enum(["0", "1"]).default("0"),
  folder: z.string().regex(/^[\w. -]{1,100}$/).optional(),
  profile: z.string().uuid().optional(),
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let running = false;

// Runs scripts/hn-top10.mjs as a subprocess and streams its output as SSE so the
// web UI can trigger a feed build without a terminal. The child is deliberately
// not killed on disconnect — the book should still be created.
export function registerScriptRunRoutes(fastify: FastifyInstance) {
  fastify.get("/scripts/hn-top10/stream", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid parameters", issues: parsed.error.issues });
    }
    const params = parsed.data;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: { type: "line" | "exit" | "error"; text?: string; code?: number }) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    if (running) {
      send({ type: "error", text: "A Hacker News build is already running — wait for it to finish" });
      res.end();
      return;
    }
    running = true;

    const args = [
      path.join(repoRoot, "scripts", "hn-top10.mjs"),
      "--api", `http://localhost:${env.PORT}`,
      "--count", String(params.count),
      ...(params.date ? ["--date", params.date] : []),
      ...(params.synthesize === "1" ? ["--synthesize"] : []),
      ...(params.folder ? ["--folder", params.folder] : []),
      ...(params.profile ? ["--profile", params.profile] : []),
    ];
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env });

    let closed = false;
    const forward = (chunk: Buffer) => {
      if (closed) return;
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) send({ type: "line", text: line });
      }
    };
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("close", (code) => {
      running = false;
      if (closed) return;
      send({ type: "exit", code: code ?? -1 });
      res.end();
    });
    child.on("error", (err) => {
      running = false;
      if (closed) return;
      send({ type: "error", text: err.message });
      res.end();
    });
    request.raw.on("close", () => {
      closed = true;
    });
  });
}
