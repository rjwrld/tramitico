-- Multi-turn via question condensation (issue #132, ADR 0012).
--
-- A follow-up ("¿y si también soy asalariado?") is rewritten server-side into
-- one standalone question, and that rewrite — not the reader's own words — is
-- what retrieval, the rerank and the answer prompt actually saw. History
-- keeps storing what the reader typed, because that is the exchange they had;
-- this column keeps the rewrite beside it, so a bad answer to a follow-up can
-- be traced to the question it was really asked against.
--
-- Nullable and with no default on purpose: NULL means "the pipeline ran on
-- `question` itself" — a first turn, or a condensation that failed and fell
-- back — and every row written before this migration is exactly that. A
-- column defaulting to a copy of `question` would say nothing about whether
-- condensation ran at all.
--
-- No grants. `anon`, `authenticated` and PUBLIC hold no privileges on
-- `public` (#123) and adding a column must not change that; the pgTAP guard
-- in supabase/tests/least_privilege.test.sql is what fails if it does.

ALTER TABLE "public"."questions"
  ADD COLUMN IF NOT EXISTS "condensed_question" "text";

COMMENT ON COLUMN "public"."questions"."condensed_question" IS
  'The standalone question the pipeline ran on when it was not the user''s own (#132). NULL when the literal question was used.';
