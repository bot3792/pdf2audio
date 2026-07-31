import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "./env.ts";
import { db } from "./db.ts";
import { books, bookFiles, type NoteJob } from "./schema.ts";
import { eq, desc } from "drizzle-orm";
import { uploadsDir } from "./lib/paths.ts";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { quickAddJob } from "graphile-worker";

const connectionString = env.DATABASE_URL;

const MAX_NOTE_PROMPT_CHARS = 4000;

async function saveUploadedFiles(request: FastifyRequest, pdfDir: string, startIndex: number) {
  const files: { index: number; filename: string; pdfPath: string }[] = [];
  const fields: Record<string, string> = {};

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === "file") {
      if (!part.filename.toLowerCase().endsWith(".pdf")) continue;
      const idx = startIndex + files.length;
      const safeName = `${String(idx).padStart(2, "0")}_${part.filename}`;
      const pdfPath = path.join(pdfDir, safeName);
      await pipeline(part.file, createWriteStream(pdfPath));
      files.push({ index: idx, filename: part.filename, pdfPath });
    } else {
      fields[part.fieldname] = (part as any).value;
    }
  }

  return { files, fields };
}

function parseNoteRequest(fields: Record<string, string>): { prompt: string; model: "flash" | "pro" } | { error: string } | null {
  const prompt = fields.notePrompt?.trim();
  if (!prompt) return null;
  if (prompt.length > MAX_NOTE_PROMPT_CHARS) {
    return { error: `notePrompt exceeds ${MAX_NOTE_PROMPT_CHARS} characters` };
  }
  const model = fields.noteModel === "pro" ? "pro" : "flash";
  return { prompt, model };
}

export function registerUploadRoutes(fastify: FastifyInstance) {
  fastify.post("/upload", async (request, reply) => {
    const bookId = randomUUID();
    const pdfDir = path.join(uploadsDir, bookId);
    await mkdir(pdfDir, { recursive: true });

    const { files, fields } = await saveUploadedFiles(request, pdfDir, 0);

    if (files.length === 0) {
      return reply.code(400).send({ error: "No PDF files uploaded" });
    }

    const note = parseNoteRequest(fields);
    if (note && "error" in note) {
      return reply.code(400).send({ error: note.error });
    }

    const firstFile = files[0];
    const title = fields.title
      || firstFile.filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    const voice = fields.voice ?? "kokoro:af_heart";
    const { parseTtsVoice } = await import("./lib/tts.ts");
    parseTtsVoice(voice);
    const speed = parseFloat(fields.speed ?? "1.0");
    const forceOcr = fields.forceOcr === "true";
    const llmChapterDetection = fields.llmChapterDetection === "true";
    const skipSynthesis = fields.skipSynthesis === "true";
    const fullExtract = fields.fullExtract === "true";

    const now = new Date().toISOString();
    const noteJob: NoteJob | undefined = note
      ? { status: "queued", prompt: note.prompt, model: note.model, createdAt: now, updatedAt: now }
      : undefined;

    const [book] = await db
      .insert(books)
      .values({
        id: bookId,
        title,
        filename: firstFile.filename,
        pdfPath: firstFile.pdfPath,
        voice,
        speed,
        forceOcr,
        llmChapterDetection,
        skipSynthesis,
        ...(noteJob ? { noteJob } : {}),
      })
      .returning();

    await db.insert(bookFiles).values(
      files.map((f) => ({
        bookId,
        index: f.index,
        filename: f.filename,
        pdfPath: f.pdfPath,
        skipSynthesis,
        status: (fullExtract ? "pending" : "raw") as "pending" | "raw",
      })),
    );

    await quickAddJob(
      { connectionString },
      "rawExtract",
      { bookId, ...(note ? { note } : {}) },
      { maxAttempts: 1 },
    );
    if (fullExtract) {
      await quickAddJob({ connectionString }, "extract", { bookId }, { maxAttempts: 1 });
    }

    return reply.send(book);
  });

  fastify.post("/upload/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) {
      return reply.code(404).send({ error: "Book not found" });
    }
    const pdfDir = path.join(uploadsDir, bookId);
    await mkdir(pdfDir, { recursive: true });

    // If this is a legacy book with no book_files rows, backfill the original file
    const existingFiles = await db
      .select()
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));

    if (existingFiles.length === 0 && book.pdfPath) {
      await db.insert(bookFiles).values({
        bookId,
        index: 0,
        filename: book.filename,
        pdfPath: book.pdfPath,
        status: "done",
      });
    }

    const usesFullExtraction =
      existingFiles.some((f) => f.status !== "raw") || existingFiles.length === 0 || book.totalChapters > 0;

    // Find the next file index
    const lastFile = await db
      .select({ index: bookFiles.index })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(desc(bookFiles.index))
      .limit(1);
    const startIndex = lastFile.length > 0 ? lastFile[0].index + 1 : 0;

    const { files } = await saveUploadedFiles(request, pdfDir, startIndex);

    if (files.length === 0) {
      return reply.code(400).send({ error: "No PDF files uploaded" });
    }

    await db.insert(bookFiles).values(
      files.map((f) => ({
        bookId,
        index: f.index,
        filename: f.filename,
        pdfPath: f.pdfPath,
        status: (usesFullExtraction ? "pending" : "raw") as "pending" | "raw",
      })),
    );

    await quickAddJob({ connectionString }, "rawExtract", { bookId }, { maxAttempts: 1 });
    if (usesFullExtraction) {
      await db.update(books).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(books.id, bookId));
      await quickAddJob({ connectionString }, "extract", { bookId }, { maxAttempts: 1 });
    }

    const [updated] = await db.select().from(books).where(eq(books.id, bookId));
    return reply.send(updated);
  });
}
