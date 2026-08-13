-- Least-privilege lockdown of the public schema (issue #123, decision on #121).
--
-- The initial schema dump (20260721184510_core_schema.sql:733-786) granted ALL
-- on every public table to `anon` and `authenticated`, and set ALTER DEFAULT
-- PRIVILEGES so every future table, sequence and function inherited the same.
-- RLS guarded the rows, but any future table shipped without a policy would
-- have been wide open — a foot-gun, not a control.
--
-- The decision on #121 is full lockdown: all data access flows through Next.js
-- API routes using `service_role`, which never leaves the server. No browser or
-- cookie-scoped client touches the Data API for table reads or writes, so
-- `anon`/`authenticated` need no privileges on `public` at all.
--
-- The RLS policies on `public.questions` stay in place deliberately: they are
-- now unreachable defense-in-depth behind the grant layer, and dropping them
-- would remove the second lock for no gain.

-- 1. Existing objects: strip every privilege from the two Data API roles.
revoke all on all tables in schema "public" from "anon", "authenticated";
revoke all on all sequences in schema "public" from "anon", "authenticated";
revoke all on all functions in schema "public" from "anon", "authenticated";
revoke all on all routines in schema "public" from "anon", "authenticated";

-- Postgres grants EXECUTE on new functions to PUBLIC by default, so revoking
-- from the two roles by name is not enough — a function reachable via PUBLIC is
-- reachable by `anon`. The four RPCs we own already revoke PUBLIC in their own
-- migrations; this covers anything created before or since without doing so.
revoke all on all functions in schema "public" from "public";
revoke all on all routines in schema "public" from "public";

-- Schema-level USAGE stays: PostgREST resolves `public` for the service role
-- through the same schema, and revoking USAGE from the Data API roles changes
-- error surfaces without adding a control the object grants above don't give.

-- 2. Future objects: undo the broad defaults, so a new table is closed until
-- someone grants on it explicitly.
alter default privileges for role "postgres" in schema "public"
  revoke all on tables from "anon", "authenticated";
alter default privileges for role "postgres" in schema "public"
  revoke all on sequences from "anon", "authenticated";
alter default privileges for role "postgres" in schema "public"
  revoke all on functions from "anon", "authenticated";
alter default privileges for role "postgres" in schema "public"
  revoke all on functions from "public";

-- 3. `service_role` keeps everything: it is the only path to the data now.
grant all on all tables in schema "public" to "service_role";
grant all on all sequences in schema "public" to "service_role";

-- The RPCs are deliberately NOT re-granted wholesale here — search_chunks,
-- replace_chunks and rate_limit_increment each grant EXECUTE to service_role in
-- their own migration, and that per-function scoping is the contract. Re-grant
-- them by name so this migration is idempotent against a database where the
-- blanket revoke above ran after they were created.
grant execute on function public.search_chunks(text, extensions.vector, int)
  to service_role;
grant execute on function public.replace_chunks(uuid, jsonb) to service_role;
grant execute on function public.rate_limit_increment(text, timestamp with time zone, timestamp with time zone)
  to service_role;

alter default privileges for role "postgres" in schema "public"
  grant all on tables to "service_role";
alter default privileges for role "postgres" in schema "public"
  grant all on sequences to "service_role";
alter default privileges for role "postgres" in schema "public"
  grant all on functions to "service_role";
