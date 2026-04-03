import { beforeAll, afterAll, inject } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/schema.ts";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

let adminSql: ReturnType<typeof postgres>;
let testSql: ReturnType<typeof postgres>;
let testDb: TestDatabase;
let currentDbName: string;

beforeAll(async () => {
  const adminUrl = inject("adminUrl");
  const templateDbName = inject("templateDbName");

  adminSql = postgres(adminUrl, { max: 1 });

  // Create unique test database from template
  currentDbName = `pdf2audio_test_${randomUUID().replace(/-/g, "")}`;
  await adminSql.unsafe(`CREATE DATABASE "${currentDbName}" TEMPLATE "${templateDbName}"`);

  // Connect to test database
  const parsed = new URL(adminUrl);
  const testUrl = `postgres://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port}/${currentDbName}`;
  testSql = postgres(testUrl);
  testDb = drizzle(testSql, { schema });
});

afterAll(async () => {
  await testSql.end();

  // Wait for connections to drop, then drop test DB
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const active = await adminSql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = ${currentDbName} AND pid <> pg_backend_pid()
    `;
    if (Number(active[0]?.count ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  await adminSql.unsafe(`DROP DATABASE IF EXISTS "${currentDbName}"`);
  await adminSql.end();
});

export async function resetDb(db: TestDatabase) {
  await db.execute(sql`DELETE FROM assemblies`);
  await db.execute(sql`DELETE FROM chapters`);
  await db.execute(sql`DELETE FROM book_files`);
  await db.execute(sql`DELETE FROM book_logs`);
  await db.execute(sql`DELETE FROM books`);
}

export function getDb() {
  return testDb;
}
