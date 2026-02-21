#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/../.env" 2>/dev/null || true

DB_URL="${DATABASE_URL:?DATABASE_URL is not set. Create a .env file from .env.example}"

psql "$DB_URL" -q <<'SQL'
\pset border 1
\pset format aligned

\echo ''
\echo '=== Graphile Worker Queue ==='
\echo ''

SELECT
  t.identifier AS "Task",
  COUNT(*) FILTER (WHERE j.locked_at IS NULL AND j.attempts < j.max_attempts) AS "Pending",
  COUNT(*) FILTER (WHERE j.locked_at IS NOT NULL) AS "Running",
  COUNT(*) FILTER (WHERE j.locked_at IS NULL AND j.attempts >= j.max_attempts) AS "Failed",
  COUNT(*) AS "Total"
FROM graphile_worker._private_jobs j
JOIN graphile_worker._private_tasks t ON t.id = j.task_id
GROUP BY t.identifier
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=== Running Jobs ==='
\echo ''

SELECT
  j.id AS "ID",
  t.identifier AS "Task",
  LEFT(j.payload->>'bookId', 8) AS "Book",
  LEFT(j.payload->>'chapterId', 8) AS "Chapter",
  TO_CHAR(j.locked_at, 'HH24:MI:SS') AS "Since",
  j.attempts || '/' || j.max_attempts AS "Attempts"
FROM graphile_worker._private_jobs j
JOIN graphile_worker._private_tasks t ON t.id = j.task_id
WHERE j.locked_at IS NOT NULL
ORDER BY j.locked_at;

\echo ''
\echo '=== Failed Jobs ==='
\echo ''

SELECT
  j.id AS "ID",
  t.identifier AS "Task",
  LEFT(j.payload->>'bookId', 8) AS "Book",
  LEFT(j.payload->>'chapterId', 8) AS "Chapter",
  LEFT(j.last_error, 60) AS "Error",
  j.attempts || '/' || j.max_attempts AS "Attempts"
FROM graphile_worker._private_jobs j
JOIN graphile_worker._private_tasks t ON t.id = j.task_id
WHERE j.locked_at IS NULL AND j.attempts >= j.max_attempts
ORDER BY j.created_at DESC
LIMIT 20;

\echo ''
\echo 'Run "pnpm jobs:clear" to delete all jobs from the queue.'
\echo ''
SQL
