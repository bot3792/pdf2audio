import { env } from "./env.ts";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.ts";
import { createContext } from "./trpc.ts";
import { startWorker, stopWorker } from "./workers/setup.ts";
import { ensureDataDirs, uploadsDir, outputDir, previewsDir } from "./lib/paths.ts";
import { db } from "./db.ts";
import { books, assemblies } from "./schema.ts";
import { eq } from "drizzle-orm";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { quickAddJob } from "graphile-worker";

const { PORT, DATABASE_URL: connectionString } = env;

async function main() {
  await ensureDataDirs();

  const fastify = Fastify({ logger: true, maxParamLength: 300 });

  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  await fastify.register(fastifyStatic, {
    root: outputDir,
    prefix: "/files/",
  });

  await fastify.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  fastify.post("/upload", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const bookId = randomUUID();
    const pdfDir = path.join(uploadsDir, bookId);
    await mkdir(pdfDir, { recursive: true });

    const filename = data.filename;
    const pdfPath = path.join(pdfDir, filename);

    await pipeline(data.file, createWriteStream(pdfPath));

    const title = filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    const voice = (data.fields.voice as any)?.value ?? "af_heart";
    const speed = parseFloat((data.fields.speed as any)?.value ?? "1.0");
    const forceOcr = (data.fields.forceOcr as any)?.value === "true";
    const llmChapterDetection = (data.fields.llmChapterDetection as any)?.value === "true";

    const [book] = await db
      .insert(books)
      .values({
        id: bookId,
        title,
        filename,
        pdfPath,
        voice,
        speed,
        forceOcr,
        llmChapterDetection,
      })
      .returning();

    await quickAddJob({ connectionString }, "extract", { bookId }, { maxAttempts: 1 });

    return reply.send(book);
  });

  fastify.get("/download/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const [book] = await db.select().from(books).where(eq(books.id, bookId));

    if (!book?.outputPath) {
      return reply.code(404).send({ error: "Book not found or not ready" });
    }

    return reply.sendFile(path.relative(outputDir, book.outputPath), outputDir);
  });

  fastify.get("/download/assembly/:assemblyId", async (request, reply) => {
    const { assemblyId } = request.params as { assemblyId: string };
    const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, assemblyId));

    if (!assembly?.outputPath) {
      return reply.code(404).send({ error: "Assembly not found" });
    }

    return reply.sendFile(path.relative(outputDir, assembly.outputPath), outputDir);
  });

  fastify.get("/audio/chapter/:chapterId", async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string };
    const { chapters: chaptersTable } = await import("./schema.ts");
    const [chapter] = await db.select().from(chaptersTable).where(eq(chaptersTable.id, chapterId));

    if (!chapter?.audioPath) {
      return reply.code(404).send({ error: "Chapter audio not found" });
    }

    return reply.sendFile(path.relative(outputDir, chapter.audioPath), outputDir);
  });

  const previewGenerating = new Set<string>();

  fastify.get("/preview/:voiceId", async (request, reply) => {
    const { voiceId } = request.params as { voiceId: string };

    if (!/^[a-z]{2}_[a-z]+$/.test(voiceId)) {
      return reply.code(400).send({ error: "Invalid voice ID" });
    }

    const mp3Path = path.join(previewsDir, `${voiceId}.mp3`);

    try {
      await access(mp3Path);
      return reply.sendFile(`${voiceId}.mp3`, previewsDir);
    } catch {}

    if (previewGenerating.has(voiceId)) {
      return reply.code(202).send({ status: "generating" });
    }

    previewGenerating.add(voiceId);

    try {
      const { synthesize } = await import("./lib/kokoro.ts");
      const { wavToMp3 } = await import("./lib/ffmpeg.ts");
      const wavPath = path.join(previewsDir, `${voiceId}.wav`);

      await synthesize({
        inputText: "The quick brown fox jumps over the lazy dog. A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with my whole heart.",
        outputPath: wavPath,
        voice: voiceId,
        speed: 1.0,
      });

      await wavToMp3(wavPath, mp3Path);
      const txtPath = wavPath.replace(/\.wav$/, ".txt");
      await import("node:fs/promises").then((fs) => Promise.all([
        fs.unlink(wavPath).catch(() => {}),
        fs.unlink(txtPath).catch(() => {}),
      ]));

      return reply.sendFile(`${voiceId}.mp3`, previewsDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Preview generation failed: ${message}` });
    } finally {
      previewGenerating.delete(voiceId);
    }
  });

  await startWorker();

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${PORT}`);

  const shutdown = async () => {
    await stopWorker();
    await fastify.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
