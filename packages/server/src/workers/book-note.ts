import { db } from "../db.ts";
import { books, type NoteJob } from "../schema.ts";
import { eq } from "drizzle-orm";
import { env } from "../env.ts";
import { deepseekChat, describeError, DEEPSEEK_MODELS } from "../lib/deepseek.ts";
import { getBookRawText } from "../lib/book-raw-text.ts";
import { estimateTokens, MODEL_CONTEXT_TOKENS } from "../lib/token-estimate.ts";
import { saveNote } from "../lib/notes.ts";
import { BOOK_RAW_SYSTEM } from "../lib/ask-ai.ts";
import { appendLog } from "../lib/log.ts";

export type BookNotePayload = {
  bookId: string;
  prompt: string;
  model: "flash" | "pro";
};

export async function bookNote(payload: BookNotePayload) {
  const { bookId, prompt, model } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error(`Book ${bookId} not found`);

  const createdAt = book.noteJob?.createdAt ?? new Date().toISOString();
  const setJob = (job: Partial<NoteJob>) =>
    db
      .update(books)
      .set({
        noteJob: { prompt, model, createdAt, status: "running", ...job, updatedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(books.id, bookId));

  const fail = async (error: string) => {
    await setJob({ status: "failed", error });
    await log(`AI note failed: ${error}`);
    throw new Error(error);
  };

  if (!env.DEEPSEEK_API_KEY) await fail("DEEPSEEK_API_KEY is not set — add it to .env");

  await setJob({ status: "running" });
  await log(`Asking ${model === "pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash"} about the whole book...`);

  const raw = await getBookRawText(bookId);
  if (!raw) return fail("No raw text available for this book");

  const tokens = estimateTokens(raw.text) + estimateTokens(prompt);
  if (tokens > MODEL_CONTEXT_TOKENS) {
    return fail(
      `Raw text (~${Math.round(tokens / 1000)}k tokens) exceeds the model's context — extract chapters and ask per-chapter instead`
    );
  }

  const system = BOOK_RAW_SYSTEM;
  const user = `${prompt}\n\n---\n${raw.text}`;

  let result: string;
  try {
    result = await deepseekChat(system, user, {
      model: DEEPSEEK_MODELS[model],
      temperature: 0.7,
      timeoutMs: 600_000,
    });
  } catch (err) {
    return fail(describeError(err));
  }

  const noteId = await saveNote({
    bookId,
    prompt,
    model,
    result,
    scope: { kind: "book-raw", files: raw.fileCount },
  });

  await setJob({ status: "done", noteId });
  await log("AI answer saved to notes");
}
