import { quickAddJob } from "graphile-worker";
import { env } from "../env.ts";

// Blanket reindex after any text mutation; unchanged units no-op on hash match,
// so callers don't need to know what changed. Never fails the calling flow.
export async function queueIndexBook(bookId: string): Promise<void> {
  try {
    await quickAddJob({ connectionString: env.DATABASE_URL }, "indexBook", { bookId }, {
      maxAttempts: 1,
      jobKey: `index:${bookId}`,
      jobKeyMode: "replace",
    });
  } catch (err) {
    console.log(`[search-index] Failed to queue indexBook (book ${bookId.slice(0, 8)}): ${err instanceof Error ? err.message : err}`);
  }
}
