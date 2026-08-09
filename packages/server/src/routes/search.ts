import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc.ts";
import { db } from "../db.ts";
import { DEFAULT_PROFILE_ID } from "../schema.ts";
import { searchLibrary } from "../lib/search.ts";

export const searchRouter = router({
  library: publicProcedure
    .input(z.object({
      query: z.string().trim().min(1).max(500),
      folderId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(30).optional(),
      mode: z.enum(["hybrid", "keyword"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return searchLibrary({ ...input, profileId: ctx.profileId ?? DEFAULT_PROFILE_ID });
    }),

  indexStatus: publicProcedure.query(async ({ ctx }) => {
    const rows = (await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE search_index->>'status' = 'done')::int AS done,
        count(*) FILTER (WHERE search_index->>'status' IN ('queued', 'chunking', 'embedding'))::int AS running,
        count(*) FILTER (WHERE search_index->>'status' = 'failed')::int AS failed
      FROM books WHERE profile_id = ${ctx.profileId ?? DEFAULT_PROFILE_ID}
    `)) as unknown as Array<{ total: number; done: number; running: number; failed: number }>;
    return rows[0];
  }),
});
