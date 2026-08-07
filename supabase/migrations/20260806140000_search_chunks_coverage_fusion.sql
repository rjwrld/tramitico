-- Hybrid retrieval RPC v2 (issue #51, ADR 0006) — coverage-scaled fallback
-- fusion, wider legs, per-leg ranks.
--
-- Changes against 20260723012234_search_chunks.sql:
--   legs     — 20 → 50 rows each, so vector-deep chunks (ley-iva Art. 10 sits
--              at vector #34 for the tarifa-general question) can reach the
--              rerank pool at all.
--   fallback — when the AND→OR relaxation (ADR 0005) fires, each lexical hit's
--              RRF contribution is scaled by the fraction of query lexemes the
--              chunk matches. One-term flood matches (541/793 chunks match the
--              OR of a typical NL question) collapse toward zero; genuinely
--              corroborated chunks keep most of their weight. The strict AND
--              branch is untouched: every match there has full coverage by
--              construction, so its scores are byte-identical to v1.
--   ranks    — vector_rank / lexical_rank (1-based, null = leg missed it) are
--              returned so the caller can compute the weak-retrieval signal
--              structurally ("no chunk in both legs") instead of from a score
--              threshold, which coverage scaling would otherwise break.
--
-- SECURITY INVOKER + service_role-only grants, unchanged from v1.

set search_path = '';

-- The return table gains columns, so the old function must go first.
drop function if exists public.search_chunks(text, extensions.vector, int);

create function public.search_chunks(
  query_text text,
  query_embedding extensions.vector,
  match_count int default 8
)
returns table (
  chunk_id uuid,
  doc_key text,
  doc_title text,
  norma text,
  articulo text,
  path text[],
  part int,
  content text,
  source jsonb,
  score double precision,
  vector_rank int,
  lexical_rank int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with query_lexemes as (
    select
      pg_catalog.array_agg(l.lexeme) as lexemes,
      pg_catalog.count(*)::float as total
    from pg_catalog.unnest(
      pg_catalog.to_tsvector('spanish', query_text)
    ) as l
  ),
  lexical_query as (
    -- websearch_to_tsquery ANDs every term, which is right for exact-term
    -- queries (tramos, CCSS, CABYS codes) but matches nothing for a full
    -- natural-language question. When the strict query hits no chunk we relax
    -- it to an OR over the same 'spanish' lexemes (ADR 0005); coverage
    -- scaling below keeps that relaxation from flooding the fusion.
    select
      case
        when strict.hits
        then pg_catalog.websearch_to_tsquery('spanish', query_text)
        else (
          select pg_catalog.string_agg(pg_catalog.quote_literal(x.lexeme), ' | ')
          from pg_catalog.unnest(ql.lexemes) as x(lexeme)
        )::tsquery
      end as query,
      not strict.hits as is_fallback
    from query_lexemes ql
    cross join (
      select exists (
        select 1
        from public.chunks c
        where c.tsv @@ pg_catalog.websearch_to_tsquery('spanish', query_text)
      ) as hits
    ) as strict
  ),
  vector_leg as (
    select
      leg.id,
      pg_catalog.row_number() over (order by leg.distance, leg.id) as rank
    from (
      select
        c.id,
        c.embedding operator(extensions.<=>) query_embedding as distance
      from public.chunks c
      where query_embedding is not null
        and c.embedding is not null
      order by 2
      limit 50
    ) as leg
  ),
  lexical_leg as (
    select
      leg.id,
      leg.coverage,
      pg_catalog.row_number() over (order by leg.rank_cd desc, leg.id) as rank
    from (
      select
        c.id,
        pg_catalog.ts_rank_cd(c.tsv, q.query) as rank_cd,
        -- Fraction of the query's lexemes this chunk matches; 1 on the strict
        -- branch, where every match contains all of them by definition.
        case
          when q.is_fallback then
            (select pg_catalog.count(*)
             from pg_catalog.unnest(ql.lexemes) as lex(lexeme)
             where c.tsv @@ pg_catalog.quote_literal(lex.lexeme)::tsquery
            )::float / ql.total
          else 1.0
        end as coverage
      from public.chunks c
      cross join lexical_query q
      cross join query_lexemes ql
      where q.query is not null
        and c.tsv @@ q.query
      order by 2 desc, c.id
      limit 50
    ) as leg
  ),
  fused as (
    select
      coalesce(v.id, l.id) as id,
      coalesce(1.0 / (60 + v.rank), 0)
        + coalesce(l.coverage * 1.0 / (60 + l.rank), 0) as score,
      v.rank as vector_rank,
      l.rank as lexical_rank
    from vector_leg v
    full outer join lexical_leg l on l.id = v.id
  )
  select
    c.id,
    d.doc_key,
    d.title,
    d.norma,
    c.articulo,
    c.path,
    c.part,
    c.content,
    d.source,
    f.score::double precision,
    f.vector_rank::int,
    f.lexical_rank::int
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.id
  limit greatest(coalesce(match_count, 8), 0);
$$;

comment on function public.search_chunks(text, extensions.vector, int) is
  'Hybrid retrieval v2 (SPEC §5, #51): pgvector cosine top-50 + spanish FTS top-50, OR-fallback contributions scaled by query-lexeme coverage, fused with RRF (k=60); returns per-leg ranks for the corroboration signal. Service-role only.';

revoke all on function public.search_chunks(text, extensions.vector, int)
  from public, anon, authenticated;

grant execute on function public.search_chunks(text, extensions.vector, int)
  to service_role;
