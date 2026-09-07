-- Guards for 20260828120000_hnsw_ef_search_rate_limits_index.sql (issue #207).
--
-- The sharp edge: an HNSW scan returns at most `hnsw.ef_search` rows no matter
-- what the SQL LIMIT says, and the pgvector default (40) sits *below* the 50
-- rows the vector leg of `search_chunks` asks for (LEG_LIMIT in
-- src/lib/retrieval.ts). On the real corpus the planner seq-scans today, so
-- the truncation is latent — which is exactly why it needs a test that forces
-- the index path. We seed synthetic chunks inside this rolled-back
-- transaction, disable seq scans, and prove the vector leg still yields all
-- LEG_LIMIT candidates through `chunks_embedding_hnsw`.
--
-- The seeds are 800 vectors in 10 tight clusters, queried near one center.
-- That shape matters: on uniform-random vectors this HNSW build returns the
-- full LIMIT even at the truncating default `ef_search = 40` (verified
-- empirically on pgvector 0.8.2), so a naive seed would green-light the very
-- regression this file exists to catch. Clustered vectors — the shape real
-- voyage embeddings actually have, where the truncation reproduces at exactly
-- 40 rows — restore the discriminating behavior: 40 rows at the default,
-- 50 under the pinned `ef_search = 80`.
--
-- Run with `pnpm test:db`. Needs only a migrated, empty database.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

-- 1. The function pins hnsw.ef_search, and above LEG_LIMIT. proconfig is the
--    source of truth for `alter function ... set`; a future migration that
--    drops and recreates search_chunks without restating it fails here.
select cmp_ok(
  (
    select split_part(cfg, '=', 2)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(p.proconfig) as cfg
    where n.nspname = 'public'
      and p.oid = 'public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[])'::regprocedure
      and cfg like 'hnsw.ef_search=%'
  ),
  '>', 50,
  'search_chunks pins hnsw.ef_search above LEG_LIMIT (50, src/lib/retrieval.ts)'
);

-- 2. Forced through the HNSW index, the vector leg still returns LEG_LIMIT
--    candidates. The empty query_text keeps the lexical leg empty (no
--    lexemes → null tsquery), so every fused row is vector-ranked. Under the
--    pgvector default ef_search=40 this returns 40 rows, not 50.
create temp table seed_centers as
select cid, array_agg(x) as center
from (
  -- Box–Muller gaussian components, one 1024-dim center per cluster.
  select cid, sqrt(-2 * ln(random())) * cos(2 * pi() * random()) as x
  from generate_series(1, 10) as cid, generate_series(1, 1024)
) t
group by cid;

insert into public.documents (id, doc_key, title, source)
values ('00000000-0000-0000-0000-000000000001', 'seed-doc', 'seed', '{}'::jsonb);

insert into public.chunks (document_id, part, content, embedding)
select
  '00000000-0000-0000-0000-000000000001',
  row_number() over (),
  'seed chunk',
  (
    select array_agg(sc.center[i] + 0.05 * (random() - 0.5))
    from generate_series(1, 1024) as i
  )::extensions.vector(1024)
from seed_centers sc, generate_series(1, 80)
;

set local enable_seqscan = off;

select is(
  (
    select count(*)
    from public.search_chunks(
      '',
      -- Query near the first cluster's center, like a real question hits the
      -- corpus's neighborhood.
      (
        select (
          select array_agg(sc.center[i] + 0.05 * (random() - 0.5))
          from generate_series(1, 1024) as i
        )::extensions.vector(1024)
        from seed_centers sc
        where sc.cid = 1
      ),
      60
    ) r
    where r.vector_rank is not null
  ),
  50::bigint,
  'vector leg returns all 50 LEG_LIMIT candidates through chunks_embedding_hnsw'
);

-- 2b. The step catalogue's vector leg (#304) is one ordered LIMIT per
--     sentence in its own subquery, so it takes the same index path: two
--     sentences near two clusters, forced through the index, still yield
--     the full LEG_LIMIT of step-ranked candidates. Empty sentence texts
--     keep the step lexical leg out of the fusion the way the empty
--     query_text does above: a placeholder word can match a real corpus
--     (`x` is a roman numeral in half the leyes) and outrank the leg.
select is(
  (
    select count(*)
    from public.search_chunks(
      '',
      null,
      60,
      null,
      null,
      array['', ''],
      (
        select array_agg(
          (
            select array_agg(sc.center[i] + 0.05 * (random() - 0.5))
            from generate_series(1, 1024) as i
          )::extensions.vector(1024)::text
        )
        from seed_centers sc
        where sc.cid in (1, 2)
      )
    ) r
    where r.step_vector_rank is not null
  ),
  50::bigint,
  'step vector leg returns all 50 LEG_LIMIT candidates through chunks_embedding_hnsw'
);

-- 3. The cleanup delete inside rate_limit_increment
--    (`where window_start < p_cutoff`) has an index to walk instead of
--    seq-scanning rate_limits on every /api/ask.
select has_index(
  'public', 'rate_limits', 'rate_limits_window_start_idx',
  array['window_start'],
  'rate_limits has the window_start index for the per-ask cleanup'
);

select * from finish();

rollback;
