-- Hybrid retrieval RPC v5 (issue #286) — the expansion leg pair.
--
-- The 2026 baseline (#267) left six cases whose expected artículo never
-- reached the fused pool. #286 measured the cause on all six: the chunks are
-- healthy (19 of 20 expected chunks retrieve themselves at vector rank 1) and
-- every one of the six queries already takes the OR-fallback lexical branch.
-- What fails is register. A reader types «me inscribí un año tarde»; the
-- artículo says «omisión de la declaración de inscripción». The Spanish
-- snowball stemmer cannot bridge those (inscrib vs inscripcion — not even a
-- shared prefix), and the vector leg puts the target at rank 96.
--
-- So the question is asked twice. The caller may hand in an *expansion* — the
-- same question rewritten into the register of the corpus (src/lib/answer/
-- expand.ts) — and this function runs the identical hybrid pair over it:
-- a vector leg on its embedding, a lexical leg on its text, fused into the
-- same RRF sum as the raw question's two legs. Four legs, equal weight, one
-- k. The raw legs are computed exactly as v4 computed them, so an expansion
-- adds candidates to the pool without removing any: a chunk the question's own
-- legs found is still a candidate. It does share the RRF sum, so the fused
-- *order* is not preserved — only a null expansion reproduces v4 exactly.
--
-- Both expansion arguments default to null, which reproduces v4 row for row.
-- That is the contract every caller without a model relies on: the integration
-- suites, `EXPAND=off`, and the ask path whenever expansion fails.

set search_path = '';

drop function if exists public.search_chunks(text, extensions.vector, int);

create function public.search_chunks(
  query_text text,
  query_embedding extensions.vector,
  match_count int default 8,
  expansion_text text default null,
  expansion_embedding extensions.vector default null
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
  lexical_rank int,
  expansion_vector_rank int,
  expansion_lexical_rank int
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- One query's lexemes, and the strict/OR switch #51 introduced. Both legs
  -- below run this same shape, once for the question and once for the
  -- expansion, so the two are ranked by identical rules.
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
  expansion_lexemes as (
    select
      pg_catalog.array_agg(l.lexeme) as lexemes,
      pg_catalog.count(*)::float as total
    from pg_catalog.unnest(
      pg_catalog.to_tsvector('spanish', coalesce(expansion_text, ''))
    ) as l
  ),
  expansion_query as (
    select
      case
        when expansion_text is null then null
        when strict.hits
        then pg_catalog.websearch_to_tsquery('spanish', expansion_text)
        else (
          select pg_catalog.string_agg(pg_catalog.quote_literal(x.lexeme), ' | ')
          from pg_catalog.unnest(xl.lexemes) as x(lexeme)
        )::tsquery
      end as query,
      not strict.hits as is_fallback
    from expansion_lexemes xl
    cross join (
      select exists (
        select 1
        from public.chunks c
        where expansion_text is not null
          and c.tsv @@ pg_catalog.websearch_to_tsquery('spanish', expansion_text)
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
  expansion_vector_leg as (
    select
      leg.id,
      pg_catalog.row_number() over (order by leg.distance, leg.id) as rank
    from (
      select
        c.id,
        c.embedding operator(extensions.<=>) expansion_embedding as distance
      from public.chunks c
      where expansion_embedding is not null
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
  expansion_lexical_leg as (
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
             from pg_catalog.unnest(xl.lexemes) as lex(lexeme)
             where c.tsv @@ pg_catalog.quote_literal(lex.lexeme)::tsquery
            )::float / xl.total
          else 1.0
        end as coverage
      from public.chunks c
      cross join expansion_query q
      cross join expansion_lexemes xl
      where q.query is not null
        and c.tsv @@ q.query
      order by 2 desc, c.id
      limit 50
    ) as leg
  ),
  -- The union is what makes four legs as readable as two: every leg is an
  -- outer contributor to one candidate set, and a leg that did not run is an
  -- empty relation whose coalesce contributes zero.
  candidates as (
    select id from vector_leg
    union select id from lexical_leg
    union select id from expansion_vector_leg
    union select id from expansion_lexical_leg
  ),
  fused as (
    select
      k.id,
      coalesce(1.0 / (60 + v.rank), 0)
        + coalesce(l.coverage * 1.0 / (60 + l.rank), 0)
        + coalesce(1.0 / (60 + xv.rank), 0)
        + coalesce(xl.coverage * 1.0 / (60 + xl.rank), 0) as score,
      v.rank as vector_rank,
      l.rank as lexical_rank,
      xv.rank as expansion_vector_rank,
      xl.rank as expansion_lexical_rank
    from candidates k
    left join vector_leg v on v.id = k.id
    left join lexical_leg l on l.id = k.id
    left join expansion_vector_leg xv on xv.id = k.id
    left join expansion_lexical_leg xl on xl.id = k.id
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
    f.lexical_rank::int,
    f.expansion_vector_rank::int,
    f.expansion_lexical_rank::int
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.id
  limit greatest(coalesce(match_count, 8), 0);
$$;

-- Dropping the function also drops the per-function HNSW setting installed
-- by #207. Load pgvector's GUC, then restore the value above LEG_LIMIT=50.
-- Two vector legs now scan under it; ef_search is per-scan, so the value is
-- unchanged.
select extensions.vector_dims('[1]'::extensions.vector);

alter function public.search_chunks(text, extensions.vector, int, text, extensions.vector)
  set hnsw.ef_search = 80;

comment on function public.search_chunks(text, extensions.vector, int, text, extensions.vector) is
  'Hybrid retrieval v5 (SPEC §5, #51/#135/#262/#286): coverage-scaled RRF over four legs — the question''s vector and lexical legs plus the same pair over an optional corpus-register expansion — with per-leg ranks and citation provenance. Service-role only.';

revoke all on function public.search_chunks(text, extensions.vector, int, text, extensions.vector)
  from public, anon, authenticated;

grant execute on function public.search_chunks(text, extensions.vector, int, text, extensions.vector)
  to service_role;
