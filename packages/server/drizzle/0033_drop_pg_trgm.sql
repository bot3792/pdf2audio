-- Created in 0026 and never used: no trigram index, no similarity(), no % operator.
-- Library search is ILIKE on titles plus Postgres FTS and pgvector, none of which need it.
DROP EXTENSION IF EXISTS pg_trgm;