import { sql } from "drizzle-orm";
import { db } from "../db.ts";

export async function folderSubtreeIds(id: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    WITH RECURSIVE sub AS (
      SELECT id FROM folders WHERE id = ${id}
      UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    SELECT id FROM sub
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function folderAncestors(id: string): Promise<{ id: string; name: string }[]> {
  const rows = (await db.execute(sql`
    WITH RECURSIVE anc AS (
      SELECT id, name, parent_id, 0 AS depth FROM folders WHERE id = ${id}
      UNION ALL
      SELECT f.id, f.name, f.parent_id, anc.depth + 1 FROM folders f JOIN anc ON f.id = anc.parent_id
    )
    SELECT id, name FROM anc ORDER BY depth DESC
  `)) as unknown as Array<{ id: string; name: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
