import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import type { TestProject } from "vitest/node";

const TEMPLATE_DB_NAME = "pdf2audio_test_template";

// Parse the DATABASE_URL to extract connection details
function parseDbUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.slice(1),
  };
}

function getAdminUrl() {
  const base = process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";
  const config = parseDbUrl(base);
  // Connect to the default 'postgres' database for admin operations
  return `postgres://${config.user}:${config.password}@${config.host}:${config.port}/postgres`;
}

function getTemplateUrl() {
  const base = process.env.DATABASE_URL ?? "postgres://pdf2audio:pdf2audio@localhost:5433/pdf2audio";
  const config = parseDbUrl(base);
  return `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${TEMPLATE_DB_NAME}`;
}

export async function setup(project: TestProject) {
  const adminUrl = getAdminUrl();

  await cleanUpTestDatabases(adminUrl);
  await createTemplateDatabase(adminUrl);

  project.provide("adminUrl", adminUrl);
  project.provide("templateDbName", TEMPLATE_DB_NAME);
}

async function createTemplateDatabase(adminUrl: string) {
  const sql = postgres(adminUrl, { max: 1 });

  try {
    // Check if template exists
    const existing = await sql`SELECT 1 FROM pg_database WHERE datname = ${TEMPLATE_DB_NAME}`;

    if (existing.length > 0) {
      // Terminate connections and drop
      await sql`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${TEMPLATE_DB_NAME} AND pid <> pg_backend_pid()
      `;
      await sql.unsafe(`DROP DATABASE "${TEMPLATE_DB_NAME}"`);
    }

    await sql.unsafe(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
  } finally {
    await sql.end();
  }

  // Run migrations on template
  const templateSql = postgres(getTemplateUrl(), { max: 1 });
  const templateDb = drizzle(templateSql);

  try {
    await migrate(templateDb, {
      migrationsFolder: path.resolve(import.meta.dirname, "../drizzle"),
    });
  } finally {
    await templateSql.end();
  }
}

async function cleanUpTestDatabases(adminUrl: string) {
  const sql = postgres(adminUrl, { max: 1 });

  try {
    const dbs = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE 'pdf2audio_test_%'
    `;

    for (const { datname } of dbs) {
      const active = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = ${datname} AND pid <> pg_backend_pid()
      `;

      if (Number(active[0]?.count ?? 0) > 0) continue;

      await sql.unsafe(`DROP DATABASE "${datname}"`);
    }
  } finally {
    await sql.end();
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    templateDbName: string;
  }
}
