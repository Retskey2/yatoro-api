-- Custom migration: prerequisites for hybrid search (see anime.schema.ts)

-- Trigram similarity: typos, word forms and partial input.
-- pg_trgm is a "trusted" extension (PG 13+), so the database owner can enable it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- array_to_string() is only STABLE, while GENERATED columns require IMMUTABLE functions.
-- Joining text[] with a space has no hidden dependencies, so the wrapper is safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION yatoro_array_to_text(arr text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURN coalesce(array_to_string(arr, ' '), '');
--> statement-breakpoint

-- The function behind `text <% text` is declared with COST 1, so the planner believes computing
-- word similarity for every row is nearly free and picks a Seq Scan over the trigram GIN index.
-- Measured on 20k titles: 438 ms (Seq Scan) vs 5 ms (Bitmap Index Scan) after this change.
-- Needs ownership of the extension's functions; without it search still works, just slower.
DO $$
DECLARE
  operator_function regprocedure;
BEGIN
  SELECT o.oprcode::regprocedure INTO operator_function
  FROM pg_operator o
  WHERE o.oprname = '<%' AND o.oprleft = 'text'::regtype AND o.oprright = 'text'::regtype;

  EXECUTE format('ALTER FUNCTION %s COST 100', operator_function);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm: no privilege to adjust operator cost, trigram search may use seq scans';
END $$;
