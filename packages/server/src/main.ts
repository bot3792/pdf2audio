import { env } from "./env.ts";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.ts";
import { createContext } from "./trpc.ts";
import { startWorker, stopWorker } from "./workers/setup.ts";
import { registerChapterReaderRoute, type ChapterReaderLookupResult } from "./lib/chapter-reader-route.ts";
import { registerUploadRoutes } from "./upload-routes.ts";
import { registerChatRoutes } from "./chat-routes.ts";
import { registerTranslationStreamRoutes } from "./translation-stream-routes.ts";
import { registerApiRoutes } from "./api-routes.ts";
import { registerScriptRunRoutes } from "./script-run-routes.ts";
import { ensureDataDirs, outputDir, previewsDir } from "./lib/paths.ts";
import { db } from "./db.ts";
import { books, bookFiles, assemblies, documents, chapters, chapterVariants } from "./schema.ts";
import { eq } from "drizzle-orm";
import path from "node:path";
import { access } from "node:fs/promises";
import { createFastifyOptions } from "./fastify-config.ts";

const { PORT } = env;

async function main() {
  await ensureDataDirs();

  const fastify = Fastify(createFastifyOptions());

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

  registerUploadRoutes(fastify);
  registerChatRoutes(fastify);
  registerTranslationStreamRoutes(fastify);
  registerApiRoutes(fastify);
  registerScriptRunRoutes(fastify);

  fastify.get("/pdf/:fileId", async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const [file] = await db.select().from(bookFiles).where(eq(bookFiles.id, fileId));
    if (!file) {
      return reply.code(404).send({ error: "File not found" });
    }
    return reply.type("application/pdf").sendFile(path.basename(file.pdfPath), path.dirname(file.pdfPath));
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

  fastify.get("/download/document/:documentId", async (request, reply) => {
    const { documentId } = request.params as { documentId: string };
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));

    if (!document?.outputPath) {
      return reply.code(404).send({ error: "Document not found" });
    }

    const mimeType = document.format === "pdf" ? "application/pdf" : "application/epub+zip";
    return reply.type(mimeType).sendFile(path.relative(outputDir, document.outputPath), outputDir);
  });

  fastify.get("/audio/chapter/:chapterId", async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string };
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));

    if (!chapter?.audioPath) {
      return reply.code(404).send({ error: "Chapter audio not found" });
    }

    return reply.sendFile(path.relative(outputDir, chapter.audioPath), outputDir);
  });

  fastify.get("/audio/translation/:translationId", async (request, reply) => {
    const { translationId } = request.params as { translationId: string };
    const [row] = await db.select().from(chapterVariants).where(eq(chapterVariants.id, translationId));

    if (!row?.audioPath) {
      return reply.code(404).send({ error: "Translation audio not found" });
    }

    return reply.sendFile(path.relative(outputDir, row.audioPath), outputDir);
  });

  fastify.get("/audio/assembly/:assemblyId", async (request, reply) => {
    const { assemblyId } = request.params as { assemblyId: string };
    const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, assemblyId));

    if (!assembly?.outputPath) {
      return reply.code(404).send({ error: "Assembly not found" });
    }

    return reply.sendFile(path.relative(outputDir, assembly.outputPath), outputDir);
  });

  registerChapterReaderRoute(fastify, async (chapterId): Promise<ChapterReaderLookupResult> => {
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
    if (!chapter) {
      return { kind: "not-found", message: "Chapter not found" };
    }

    const [book] = await db.select().from(books).where(eq(books.id, chapter.bookId));
    if (!book) {
      return { kind: "not-found", message: "Book not found" };
    }

    if (!Array.isArray(chapter.sourceBlocks)) {
      return { kind: "not-found", message: "Chapter source blocks not found" };
    }

    return {
      kind: "ok",
      chapter: {
        bookTitle: book.title,
        chapterTitle: chapter.title,
        pageStart: chapter.pageStart,
        pageEnd: chapter.pageEnd,
        sourceBlocks: chapter.sourceBlocks,
      },
    };
  });

  const previewGenerating = new Set<string>();

  fastify.get("/preview/:voiceId", async (request, reply) => {
    const { voiceId } = request.params as { voiceId: string };
    const previewKey = encodeURIComponent(voiceId);

    try {
      const { parseTtsVoice } = await import("./lib/tts.ts");
      parseTtsVoice(voiceId);
    } catch {
      return reply.code(400).send({ error: "Invalid voice ID" });
    }

    const mp3Path = path.join(previewsDir, `${previewKey}.mp3`);

    try {
      await access(mp3Path);
      return reply.sendFile(`${previewKey}.mp3`, previewsDir);
    } catch {}

    if (previewGenerating.has(voiceId)) {
      return reply.code(202).send({ status: "generating" });
    }

    previewGenerating.add(voiceId);

    try {
      const { synthesize, getPreviewTextForVoice } = await import("./lib/tts.ts");
      const { wavToMp3 } = await import("./lib/ffmpeg.ts");
      const wavPath = path.join(previewsDir, `${previewKey}.wav`);

      await synthesize({
        inputText: getPreviewTextForVoice(voiceId),
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

      return reply.sendFile(`${previewKey}.mp3`, previewsDir);
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
