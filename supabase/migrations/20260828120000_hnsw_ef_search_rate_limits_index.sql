-- Two latent performance/correctness fixes from the #207 review.
--
-- 1. `hnsw.ef_search` vs the vector leg's LIMIT. An HNSW scan returns at most
--    `hnsw.ef_search` rows regardless of the SQL LIMIT, and the pgvector
--    default is 40 — below the 50 rows the vector leg of `search_chunks` asks
--    for (LEG_LIMIT in src/lib/retrieval.ts, deliberately widened in
--    ADR-0006). Today the planner seq-scans the small corpus and the limit is
--    honoured; the day `chunks_embedding_hnsw` wins, retrieval would silently
--    truncate to 40 candidates. Pinning the GUC on the function keeps the
--    setting scoped to exactly the query that needs it.
--
--    80 = 2 × LEG_LIMIT: comfortably above the limit so HNSW recall at
--    LIMIT 50 stays high, cheap enough not to matter. If LEG_LIMIT moves,
--    this value must move with it (and stay strictly above it).
--
--    NOTE for future `search_chunks` migrations: `drop function` discards this
--    setting, so any migration that drops and recreates the function must
--    restate the `alter function ... set` below.
--
--    The no-op vector_dims call is load-bearing: `hnsw.ef_search` only exists
--    once vector.so is loaded into the backend, and until then Postgres
--    treats it as a placeholder GUC that the non-superuser `postgres` role is
--    not allowed to set ("permission denied to set parameter"). Touching any
--    pgvector C function first loads the module and registers the GUC as
--    USERSET.
select extensions.vector_dims('[1]'::extensions.vector);

alter function public.search_chunks(text, extensions.vector, int)
  set hnsw.ef_search = 80;

-- 2. `rate_limit_increment` opportunistically deletes rows past retention
--    (`delete from rate_limits where window_start < p_cutoff`) on every
--    /api/ask, and `rate_limits` only had its PK on `subject` — verified via
--    EXPLAIN to seq-scan the whole table each time. Small today, unbounded
--    with users.
create index rate_limits_window_start_idx
  on public.rate_limits (window_start);
