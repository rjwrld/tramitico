-- Hybrid retrieval RPC v6 (issue #304) — the step-catalogue leg pair.
--
-- #303 located every missing Tier 1 requirement in the reranked order and
-- found the retrieval-caused ones were pool depth, not the rerank cut: the
-- chunk that carries the requirement was deep in the 40 or absent from it.
-- The absent ones share a shape — a *step* a complete answer needs and the
-- question never asks for: when to pay, what the sanction is, how to adjust a
-- declared figure. Nothing in the question points at them, so neither its own
-- legs nor its corpus-register rewrite (#286) find them, and #303 measured
-- that a model cannot be asked to guess them.
--
-- So the caller may hand in a *step catalogue*: the sentences the dataset's
-- family names as its steps, written by hand in the corpus's register
-- (eval/step-catalogue.json, src/lib/answer/steps.ts). This function runs
-- one more hybrid pair over them, the #286 shape with one difference that the
-- measurement forced: the sentences are searched **one by one**, not as one
-- text. Concatenated, a three-sentence probe carried «¿Cuándo me corresponde
-- pagar…?» at pool #17 and `cnpt` art. 79 not at all; each sentence alone
-- carries its chunk at vector rank 1. So each sentence is ranked on its own —
-- its 50 nearest chunks, its 50 best lexical matches — and the step leg is
-- the interleave of those lists: a chunk's step rank is its **best rank in
-- any sentence's list**, so the three sentences' first choices come first,
-- then their seconds, and so on. Not "nearest by distance across
-- sentences": distances are not comparable between sentences as a primary
-- key, and a first measurement that merged them that way let one sentence's
-- fifty nearest chunks crowd out another sentence's first (cnpt art. 79 at
-- vector rank 1 for its sentence, and still outside the leg). Among chunks
-- of *equal* sentence rank — the three sentences' firsts, say — the smaller
-- distance (or higher rank_cd) is only the tie-break, and it is a heuristic:
-- it decides which first is #1 and which is #3, never whether a first makes
-- the leg. Two legs, one k, the same 50-row limit as every other leg — a
-- catalogue of three sentences weighs what one expansion weighs, not three
-- times that. Each sentence's `order by … limit 50` sits in its own
-- subquery with the ranking window outside it, the shape every other leg
-- has, so the planner can push the ordered LIMIT into the HNSW index
-- (supabase/tests/retrieval_perf.test.sql covers the step leg too).
--
-- The raw and expansion legs are computed exactly as v5 computed them, so the
-- catalogue adds candidates without removing any; it shares the RRF sum, so
-- the fused *order* is not preserved. Both step arguments default to null,
-- which reproduces v5 row for row: that is the contract every caller without
-- a catalogue relies on — `STEPS=off`, and a question that names no family.
--
-- `step_embeddings` is `text[]` of pgvector literals rather than `vector[]`
-- so a slot whose embed failed can travel as null beside its text, which
-- keeps that sentence's lexical leg the way `expansion_embedding: null` keeps
-- the expansion's (#286).

set search_path = '';

drop function if exists public.search_chunks(text, extensions.vector, int, text, extensions.vector);

create function public.search_chunks(
  query_text text,
  query_embedding extensions.vector,
  match_count int default 8,
  expansion_text text default null,
  expansion_embedding extensions.vector default null,
  step_texts text[] default null,
  step_embeddings text[] default null
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
  expansion_lexical_rank int,
  step_vector_rank int,
  step_lexical_rank int
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
  -- The catalogue, one row per sentence, its embedding beside it when the
  -- caller had one. A text with no embedding keeps its lexical leg.
  step_sentences as (
    select
      s.n,
      s.text,
      e.literal::extensions.vector as embedding
    from pg_catalog.unnest(coalesce(step_texts, '{}'::text[]))
      with ordinality as s(text, n)
    left join pg_catalog.unnest(coalesce(step_embeddings, '{}'::text[]))
      with ordinality as e(literal, n) on e.n = s.n
    where s.text is not null
  ),
  -- Each sentence's lexemes and its own strict/OR switch: the same rules the
  -- question and the expansion are ranked by, applied per sentence.
  step_queries as (
    select
      s.n,
      case
        when strict.hits
        then pg_catalog.websearch_to_tsquery('spanish', s.text)
        else (
          select pg_catalog.string_agg(pg_catalog.quote_literal(x.lexeme), ' | ')
          from pg_catalog.unnest(sl.lexemes) as x(lexeme)
        )::tsquery
      end as query,
      not strict.hits as is_fallback,
      sl.lexemes,
      sl.total
    from step_sentences s
    cross join lateral (
      select
        pg_catalog.array_agg(l.lexeme) as lexemes,
        pg_catalog.count(*)::float as total
      from pg_catalog.unnest(pg_catalog.to_tsvector('spanish', s.text)) as l
    ) as sl
    cross join lateral (
      select exists (
        select 1
        from public.chunks c
        where c.tsv @@ pg_catalog.websearch_to_tsquery('spanish', s.text)
      ) as hits
    ) as strict
    where sl.total > 0
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
  -- Best sentence rank wins: each sentence's own 50 nearest chunks, ranked
  -- within that sentence; then one row per chunk — its best sentence rank,
  -- ties to the smaller distance — and one leg of 50 over those.
  step_vector_leg as (
    select
      leg.id,
      pg_catalog.row_number() over (
        order by leg.sentence_rank, leg.distance, leg.id
      ) as rank
    from (
      select distinct on (near.id)
        near.id,
        near.sentence_rank,
        near.distance
      from step_sentences s
      cross join lateral (
        select
          nearest.id,
          nearest.distance,
          pg_catalog.row_number() over (
            order by nearest.distance, nearest.id
          ) as sentence_rank
        from (
          select
            c.id,
            c.embedding operator(extensions.<=>) s.embedding as distance
          from public.chunks c
          where s.embedding is not null
            and c.embedding is not null
          order by 2
          limit 50
        ) as nearest
      ) as near
      order by near.id, near.sentence_rank, near.distance
    ) as leg
    order by leg.sentence_rank, leg.distance, leg.id
    limit 50
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
  -- Best sentence rank wins, the same way: each sentence's own 50 best
  -- lexical matches ranked within that sentence, then one row per chunk —
  -- its best sentence rank, with that sentence's coverage — and one leg of
  -- 50 over those.
  step_lexical_leg as (
    select
      leg.id,
      leg.coverage,
      pg_catalog.row_number() over (
        order by leg.sentence_rank, leg.rank_cd desc, leg.id
      ) as rank
    from (
      select distinct on (best.id)
        best.id,
        best.sentence_rank,
        best.rank_cd,
        best.coverage
      from step_queries q
      cross join lateral (
        select
          matched.id,
          matched.rank_cd,
          matched.coverage,
          pg_catalog.row_number() over (
            order by matched.rank_cd desc, matched.id
          ) as sentence_rank
        from (
          select
            c.id,
            pg_catalog.ts_rank_cd(c.tsv, q.query) as rank_cd,
            case
              when q.is_fallback then
                (select pg_catalog.count(*)
                 from pg_catalog.unnest(q.lexemes) as lex(lexeme)
                 where c.tsv @@ pg_catalog.quote_literal(lex.lexeme)::tsquery
                )::float / q.total
              else 1.0
            end as coverage
          from public.chunks c
          where q.query is not null
            and c.tsv @@ q.query
          order by 2 desc, c.id
          limit 50
        ) as matched
      ) as best
      order by best.id, best.sentence_rank, best.rank_cd desc
    ) as leg
    order by leg.sentence_rank, leg.rank_cd desc, leg.id
    limit 50
  ),
  -- The union is what makes six legs as readable as two: every leg is an
  -- outer contributor to one candidate set, and a leg that did not run is an
  -- empty relation whose coalesce contributes zero.
  candidates as (
    select id from vector_leg
    union select id from lexical_leg
    union select id from expansion_vector_leg
    union select id from expansion_lexical_leg
    union select id from step_vector_leg
    union select id from step_lexical_leg
  ),
  fused as (
    select
      k.id,
      coalesce(1.0 / (60 + v.rank), 0)
        + coalesce(l.coverage * 1.0 / (60 + l.rank), 0)
        + coalesce(1.0 / (60 + xv.rank), 0)
        + coalesce(xl.coverage * 1.0 / (60 + xl.rank), 0)
        + coalesce(1.0 / (60 + sv.rank), 0)
        + coalesce(sl.coverage * 1.0 / (60 + sl.rank), 0) as score,
      v.rank as vector_rank,
      l.rank as lexical_rank,
      xv.rank as expansion_vector_rank,
      xl.rank as expansion_lexical_rank,
      sv.rank as step_vector_rank,
      sl.rank as step_lexical_rank
    from candidates k
    left join vector_leg v on v.id = k.id
    left join lexical_leg l on l.id = k.id
    left join expansion_vector_leg xv on xv.id = k.id
    left join expansion_lexical_leg xl on xl.id = k.id
    left join step_vector_leg sv on sv.id = k.id
    left join step_lexical_leg sl on sl.id = k.id
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
    f.expansion_lexical_rank::int,
    f.step_vector_rank::int,
    f.step_lexical_rank::int
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.id
  limit greatest(coalesce(match_count, 8), 0);
$$;

-- Dropping the function also drops the per-function HNSW setting installed
-- by #207. Load pgvector's GUC, then restore the value above LEG_LIMIT=50.
-- Each sentence is its own scan under it; ef_search is per-scan, so the
-- value is unchanged.
select extensions.vector_dims('[1]'::extensions.vector);

alter function public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[])
  set hnsw.ef_search = 80;

comment on function public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[]) is
  'Hybrid retrieval v6 (SPEC §5, #51/#135/#262/#286/#304): coverage-scaled RRF over six legs — the question''s vector and lexical legs, the same pair over an optional corpus-register expansion, and one pair over an optional per-family step catalogue searched sentence by sentence — with per-leg ranks and citation provenance. Service-role only.';

revoke all on function public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[])
  from public, anon, authenticated;

grant execute on function public.search_chunks(text, extensions.vector, int, text, extensions.vector, text[], text[])
  to service_role;
