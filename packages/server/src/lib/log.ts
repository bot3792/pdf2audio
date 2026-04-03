import { db } from "../db.ts";
import { bookLogs } from "../schema.ts";

export async function appendLog(bookId: string, message: string, fileIndex?: number) {
  console.log(`[book ${bookId.slice(0, 8)}] ${message}`);
  await db.insert(bookLogs).values({ bookId, message, fileIndex: fileIndex ?? null });
}
