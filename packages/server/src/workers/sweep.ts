import { sql } from "drizzle-orm";
import { quickAddJob } from "graphile-worker";
import { db } from "../db.ts";
import { appendLog } from "../lib/log.ts";
import { env } from "../env.ts";

const connectionString = env.DATABASE_URL;

// Every app job runs with maxAttempts: 1, so a job whose attempt died with the server
// (exhausted, or still locked by a dead worker) will never run again on its own. This
// runs once at boot, before this process's runner starts, so any lock it sees is orphaned.
export async function sweepStrandedWork() {
  const [{ jobs_table }] = (await db.execute(
    sql`SELECT to_regclass('graphile_worker._private_jobs') AS jobs_table`,
  )) as unknown as Array<{ jobs_table: string | null }>;
  if (!jobs_table) return;

  const recoveredByBook = new Map<string, number>();
  const bump = (bookId: string) => recoveredByBook.set(bookId, (recoveredByBook.get(bookId) ?? 0) + 1);

  const deadJobs = (await db.execute(sql`
    DELETE FROM graphile_worker._private_jobs j
    USING graphile_worker._private_tasks t
    WHERE t.id = j.task_id
      AND t.identifier IN ('normalize', 'synthesize', 'translate', 'synthesizeTranslation', 'assemble')
      AND (j.locked_at IS NOT NULL OR j.attempts >= j.max_attempts)
    RETURNING t.identifier, j.payload
  `)) as unknown as Array<{ identifier: string; payload: Record<string, unknown> }>;

  // Assemblies have no per-row state to recover from; replay the dead job's own payload.
  const replayedAssembleBooks: string[] = [];
  for (const job of deadJobs.filter((j) => j.identifier === "assemble")) {
    await quickAddJob({ connectionString }, "assemble", job.payload, { maxAttempts: 1 });
    if (typeof job.payload.bookId === "string") {
      replayedAssembleBooks.push(job.payload.bookId);
      bump(job.payload.bookId);
    }
  }

  await db.execute(sql`
    UPDATE books SET status = 'done', updated_at = now()
    WHERE status = 'assembling'
      AND id::text NOT IN (SELECT json_array_elements_text(${JSON.stringify(replayedAssembleBooks)}::json))
      AND id::text NOT IN (
        SELECT j.payload->>'bookId' FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier = 'assemble' AND j.payload->>'bookId' IS NOT NULL)
  `);

  const strandedChapters = (await db.execute(sql`
    UPDATE chapters c SET status = 'pending', error = NULL
    WHERE c.status IN ('pending', 'normalizing', 'synthesizing')
      AND c.id::text NOT IN (
        SELECT j.payload->>'chapterId' FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier IN ('normalize', 'synthesize') AND j.payload->>'chapterId' IS NOT NULL)
    RETURNING c.id, c.book_id, c.clean_text IS NOT NULL AS has_clean_text
  `)) as unknown as Array<{ id: string; book_id: string; has_clean_text: boolean }>;

  for (const ch of strandedChapters) {
    if (ch.has_clean_text) {
      await quickAddJob({ connectionString }, "synthesize", { chapterId: ch.id, bookId: ch.book_id, resume: true }, { maxAttempts: 1 });
    } else {
      await quickAddJob({ connectionString }, "normalize", { chapterId: ch.id, bookId: ch.book_id }, { maxAttempts: 1 });
    }
    bump(ch.book_id);
  }

  const strandedTranslations = (await db.execute(sql`
    UPDATE chapter_translations ct SET status = 'pending', error = NULL, updated_at = now()
    FROM chapters c
    WHERE c.id = ct.chapter_id
      AND ct.status IN ('pending', 'translating')
      AND ct.id::text NOT IN (
        SELECT j.payload->>'translationId' FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier = 'translate' AND j.payload->>'translationId' IS NOT NULL)
    RETURNING ct.id, c.book_id
  `)) as unknown as Array<{ id: string; book_id: string }>;

  for (const tr of strandedTranslations) {
    await quickAddJob({ connectionString }, "translate", { translationId: tr.id, bookId: tr.book_id }, { maxAttempts: 1 });
    bump(tr.book_id);
  }

  // Only finished translations: audio_status='pending' on an unfinished one is the deferred
  // marker the translate worker resolves itself when the translation completes.
  const strandedAudio = (await db.execute(sql`
    UPDATE chapter_translations ct SET audio_status = 'pending', audio_error = NULL, updated_at = now()
    FROM chapters c
    WHERE c.id = ct.chapter_id
      AND ct.status = 'done'
      AND ct.audio_status IN ('pending', 'synthesizing')
      AND ct.id::text NOT IN (
        SELECT j.payload->>'translationId' FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier = 'synthesizeTranslation' AND j.payload->>'translationId' IS NOT NULL)
    RETURNING ct.id, c.book_id
  `)) as unknown as Array<{ id: string; book_id: string }>;

  for (const tr of strandedAudio) {
    await quickAddJob({ connectionString }, "synthesizeTranslation", { translationId: tr.id, bookId: tr.book_id, resume: true }, { maxAttempts: 1 });
    bump(tr.book_id);
  }

  for (const [bookId, count] of recoveredByBook) {
    await appendLog(bookId, `Recovered ${count} interrupted job${count === 1 ? "" : "s"} after server restart`);
  }
  const total = [...recoveredByBook.values()].reduce((a, b) => a + b, 0);
  if (total > 0 || deadJobs.length > 0) {
    console.log(`[worker] Startup sweep: purged ${deadJobs.length} dead job(s), requeued ${total} stranded job(s)`);
  }
}
