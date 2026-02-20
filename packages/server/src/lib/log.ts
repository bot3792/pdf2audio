import { db } from "../db.ts";
import { bookLogs } from "../schema.ts";

export async function appendLog(bookId: string, message: string) {
  await db.insert(bookLogs).values({ bookId, message });
}
