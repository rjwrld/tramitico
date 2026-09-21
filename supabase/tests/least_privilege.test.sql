-- SQL-level proof of the least-privilege lockdown (issue #147, guarding #123).
--
-- 20260812120000_least_privilege.sql revoked every `anon`/`authenticated`
-- privilege on `public`. The PostgREST round-trip in
-- src/lib/history.integration.test.ts proves the door is shut for the handful
-- of tables a test happens to name; this file proves it for *every* object in
-- the schema, including ones added tomorrow, by reading the ACLs directly.
--
-- Why that matters: the broad grants #123 removed arrived in a generated
-- schema dump (20260721184510_core_schema.sql:733-786). Regenerating that
-- file, or any tool re-emitting grants, silently undoes the revocation. This
-- is the guard for exactly that.
--
-- Run with `pnpm test:db` (a running local stack), or in CI on the throwaway
-- `supabase start` stack. No secrets, no hosted project.
--
-- ACLs are read from pg_class/pg_proc/pg_default_acl rather than
-- information_schema, which filters rows by the enabled roles of the caller
-- and would quietly under-report. `aclexplode` grantee 0 is PUBLIC.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- 1. Tables, views and sequences: no privilege of any kind, for either Data
--    API role or for PUBLIC. A NULL relacl means "owner only", which is why
--    the lateral join dropping those rows is the right answer here.
select is_empty(
  $$
    select
      c.relkind::text || ' ' || c.relname::text
        || ' -> ' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  $$,
  'anon/authenticated/PUBLIC hold no privileges on any public table, view or sequence'
);

-- 2. Functions: same sweep.
select is_empty(
  $$
    select
      p.oid::regprocedure::text
        || ' -> ' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where n.nspname = 'public'
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  $$,
  'anon/authenticated/PUBLIC hold no privileges on any public function'
);

-- 3. A NULL proacl is NOT "owner only" for a function — Postgres reads it as
--    the default, which grants EXECUTE to PUBLIC, and therefore to anon. A new
--    RPC shipped without its own `revoke ... from public` lands here, where
--    check 2 above cannot see it.
select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proacl is null
  $$,
  'every public function has an explicit ACL (a NULL one means EXECUTE to PUBLIC)'
);

-- 4. Future objects. `alter default privileges for role postgres` is what the
--    original dump used to hand every future table to anon/authenticated;
--    migrations run as `postgres`, so this is the entry that governs what a
--    new table inherits.
--
--    `auto_expose_new_tables = false` in supabase/config.toml, and the hosted
--    project's "Automatically expose new tables" toggle it mirrors (off since
--    2026-09-19), edit exactly this `postgres` row and nothing else: the CLI
--    implements the setting as `alter default privileges for role postgres in
--    schema public revoke ... from anon, authenticated, service_role`, and
--    the platform does the same at project creation. That means the toggle
--    and 20260812120000_least_privilege.sql are two ways of writing the same
--    row, and this check is what notices if either is undone.
select is_empty(
  $$
    select
      d.defaclobjtype::text
        || ' -> ' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public'
      and pg_get_userbyid(d.defaclrole) = 'postgres'
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  $$,
  'default privileges for role postgres in public grant nothing to anon/authenticated/PUBLIC'
);

-- 4b. Every other owner (#382). pg_default_acl in `public` carries a second
--     set of rows, owned by `supabase_admin`, that still grant ALL on future
--     tables, sequences and functions to anon/authenticated. Characterised on
--     the local stack (Postgres 17, supabase_admin is the image's superuser):
--
--       supabase_admin | public | r | {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/...,authenticated=arwdDxtm/...,service_role=...}
--       supabase_admin | public | S | {postgres=rwU/supabase_admin,anon=rwU/...,authenticated=rwU/...,service_role=...}
--       supabase_admin | public | f | {postgres=X/supabase_admin,anon=X/...,authenticated=X/...,service_role=...}
--
--     A migration cannot remove them: `alter default privileges for role
--     supabase_admin` needs membership in that role, migrations run as
--     `postgres`, and `postgres` is not a member — locally the statement
--     fails with "permission denied to change default privileges", and the
--     hosted project never hands out supabase_admin at all. The rows are
--     written by the image's init scripts, so a `db reset` would recreate
--     them anyway. They govern only objects supabase_admin itself creates,
--     which none of our migrations do, and neither the config.toml setting
--     nor the hosted toggle touches them (see check 4).
--
--     So instead of "no row, any owner" — which would fail on every stack —
--     this pins the *exact* set of (owner, object type, grantee) triples in
--     `public` that grant to anon/authenticated/PUBLIC, and expects it to be
--     precisely those six platform rows. Any addition fails it: a regenerated
--     dump re-granting on the `postgres` row (also caught by check 4), a
--     PUBLIC grantee, or a new owner. A row *disappearing* fails it too, on
--     purpose — that is the platform removing its half, and the day it does
--     this check should tighten to is_empty rather than keep pinning.
--     Privilege names are deliberately left out of the key: MAINTAIN ('m') is
--     Postgres 17+, and a major-version bump should not fail a guard that is
--     about *who* is granted, not *what*.
select set_eq(
  $$
    select distinct
      pg_get_userbyid(d.defaclrole)::text
        || ' ' || d.defaclobjtype::text
        || ' -> ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public'
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  $$,
  array[
    'supabase_admin S -> anon',
    'supabase_admin S -> authenticated',
    'supabase_admin f -> anon',
    'supabase_admin f -> authenticated',
    'supabase_admin r -> anon',
    'supabase_admin r -> authenticated'
  ]::text[],
  'the only default privileges in public reaching anon/authenticated/PUBLIC are the six platform-owned supabase_admin rows'
);

-- 5. Positive control. A lockdown that also locked out `service_role` would
--    pass every check above and break every API route; the suite has to be
--    able to tell the two apart.
select isnt_empty(
  $$
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname = 'questions'
      and pg_get_userbyid(a.grantee) = 'service_role'
  $$,
  'service_role still holds privileges on public.questions (the only data path)'
);

-- 5b. Positive controls, per surface (#207). Check 5 proves service_role holds
--     *something*; before these, revoking service_role EXECUTE on
--     `search_chunks` — or its privileges on `chunks`/`documents`/
--     `rate_limits` — would have passed every assertion in this file while
--     breaking every API route. One check per owned RPC, one per table a
--     route depends on, each naming the privileges the routes actually
--     exercise.
select ok(
  has_function_privilege(
    'service_role',
    'public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[])'::regprocedure,
    'execute'),
  'service_role can execute search_chunks (the /api/ask retrieval path)'
);
select ok(
  has_function_privilege(
    'service_role', 'public.replace_chunks(uuid, jsonb)'::regprocedure,
    'execute'),
  'service_role can execute replace_chunks (the ingest path)'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.rate_limit_increment(text, timestamptz, timestamptz)'::regprocedure,
    'execute'),
  'service_role can execute rate_limit_increment (the quota path)'
);
select ok(
  has_function_privilege(
    'service_role', 'public.rate_limit_refund(text, timestamptz)'::regprocedure,
    'execute'),
  'service_role can execute rate_limit_refund (the quota refund path)'
);

-- The RPCs above are SECURITY INVOKER, so service_role also needs the table
-- privileges each body exercises. has_table_privilege with a privilege list
-- is an OR, so each required privilege is asserted on its own and ANDed.
select ok(
  has_table_privilege('service_role', 'public.questions', 'select')
    and has_table_privilege('service_role', 'public.questions', 'insert')
    and has_table_privilege('service_role', 'public.questions', 'delete'),
  'service_role can select/insert/delete public.questions (history routes)'
);
select ok(
  has_table_privilege('service_role', 'public.chunks', 'select')
    and has_table_privilege('service_role', 'public.chunks', 'insert')
    and has_table_privilege('service_role', 'public.chunks', 'delete'),
  'service_role can select/insert/delete public.chunks (retrieval + replace_chunks)'
);
select ok(
  has_table_privilege('service_role', 'public.documents', 'select')
    and has_table_privilege('service_role', 'public.documents', 'insert')
    and has_table_privilege('service_role', 'public.documents', 'update'),
  'service_role can select/insert/update public.documents (retrieval + ingest upsert)'
);
select ok(
  has_table_privilege('service_role', 'public.rate_limits', 'select')
    and has_table_privilege('service_role', 'public.rate_limits', 'insert')
    and has_table_privilege('service_role', 'public.rate_limits', 'update')
    and has_table_privilege('service_role', 'public.rate_limits', 'delete'),
  'service_role holds all four DML privileges on public.rate_limits (quota RPCs)'
);

-- 6. RLS on public.questions (issue #147 req. 4). #123 keeps these policies as
--    defense in depth behind the grant layer, which makes them unreachable
--    through the Data API and therefore untestable from PostgREST. Nothing
--    else guards them against a future migration dropping them.
select policies_are(
  'public',
  'questions',
  array['select own history', 'insert own history', 'delete own history'],
  'public.questions keeps its three defense-in-depth RLS policies (#123)'
);

select policy_cmd_is(
  'public', 'questions', 'select own history', 'select',
  'the select policy still covers SELECT'
);
select policy_cmd_is(
  'public', 'questions', 'insert own history', 'insert',
  'the insert policy still covers INSERT'
);
select policy_cmd_is(
  'public', 'questions', 'delete own history', 'delete',
  'the delete policy still covers DELETE'
);

-- Policies that exist but are not enforced are decoration.
select ok(
  (select c.relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'questions'),
  'row level security is enabled on public.questions'
);

select * from finish();

rollback;
