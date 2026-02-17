import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.ts";
import { createContext } from "./trpc.ts";
import { startWorker } from "./workers/setup.ts";
import { ensureDataDirs, uploadsDir, outputDir } from "./lib/paths.ts";
import { db } from "./db.ts";
import { books } from "./schema.ts";
import { eq } from "drizzle-orm";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { quickAddJob } from "graphile-worker";

const PORT = parseInt(process.env.PORT ?? "3034", 10);
const connectionString = process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";

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

    const [book] = await db
      .insert(books)
      .values({
        id: bookId,
        title,
        filename,
        pdfPath,
        voice,
        speed,
      })
      .returning();

    await quickAddJob({ connectionString }, "extract", { bookId });

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

  fastify.get("/audio/chapter/:chapterId", async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string };
    const { chapters: chaptersTable } = await import("./schema.ts");
    const [chapter] = await db.select().from(chaptersTable).where(eq(chaptersTable.id, chapterId));

    if (!chapter?.audioPath) {
      return reply.code(404).send({ error: "Chapter audio not found" });
    }

    return reply.sendFile(path.relative(outputDir, chapter.audioPath), outputDir);
  });

  const worker = await startWorker();

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${PORT}`);

  const shutdown = async () => {
    await worker.stop();
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
