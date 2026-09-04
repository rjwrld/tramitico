-- Hybrid retrieval RPC v4 (issue #262) — carry both provenance dates to the
-- sello: effective_date says when the source took effect; fetched_at says
-- when this corpus last consulted it. Fusion and ranking are unchanged.

set search_path = '';

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
  effective_date date,
  fetched_at timestamptz,
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
    d.effective_date,
    d.fetched_at,
    f.score::double precision,
    f.vector_rank::int,
    f.lexical_rank::int
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.id
  limit greatest(coalesce(match_count, 8), 0);
$$;

-- Dropping the function also drops the per-function HNSW setting installed
-- by #207. Load pgvector's GUC, then restore the value above LEG_LIMIT=50.
select extensions.vector_dims('[1]'::extensions.vector);

alter function public.search_chunks(text, extensions.vector, int)
  set hnsw.ef_search = 80;

comment on function public.search_chunks(text, extensions.vector, int) is
  'Hybrid retrieval v4 (SPEC §5, #51/#135/#262): coverage-scaled RRF with per-leg ranks; returns effective_date and fetched_at for citation provenance. Service-role only.';

revoke all on function public.search_chunks(text, extensions.vector, int)
  from public, anon, authenticated;

grant execute on function public.search_chunks(text, extensions.vector, int)
  to service_role;
