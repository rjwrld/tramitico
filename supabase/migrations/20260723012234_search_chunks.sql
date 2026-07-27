-- Hybrid retrieval RPC (SPEC §5, issue #20).
--
-- Two legs over public.chunks, fused with reciprocal rank fusion:
--   vector  — cosine distance against the query embedding, top 20
--   lexical — websearch_to_tsquery('spanish') ranked with ts_rank_cd, top 20
--   fusion  — score = Σ 1/(k + rank_in_leg), k = 60; top match_count returned
--
-- SECURITY INVOKER: the caller's own privileges apply. Only service_role may
-- execute it (see grants at the bottom), so RLS on chunks/documents — neither
-- of which has a read policy — is bypassed by that role alone, never by anon.

set search_path = '';

create or replace function public.search_chunks(
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
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lexical_query as (
    -- websearch_to_tsquery ANDs every term, which is right for exact-term
    -- queries (tramos, CCSS, CABYS codes) but matches nothing for a full
    -- natural-language question. When the strict query hits no chunk we relax
    -- it to an OR over the same 'spanish' lexemes; ts_rank_cd then still ranks
    -- the chunks matching more of the question first.
    select case
      when exists (
        select 1
        from public.chunks c
        where c.tsv @@ pg_catalog.websearch_to_tsquery('spanish', query_text)
      )
      then pg_catalog.websearch_to_tsquery('spanish', query_text)
      else (
        select pg_catalog.string_agg(pg_catalog.quote_literal(l.lexeme), ' | ')
        from pg_catalog.unnest(
          pg_catalog.to_tsvector('spanish', query_text)
        ) as l
      )::tsquery
    end as query
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
      limit 20
    ) as leg
  ),
  lexical_leg as (
    select
      leg.id,
      pg_catalog.row_number() over (order by leg.rank_cd desc, leg.id) as rank
    from (
      select c.id, pg_catalog.ts_rank_cd(c.tsv, q.query) as rank_cd
      from public.chunks c
      cross join lexical_query q
      where q.query is not null
        and c.tsv @@ q.query
      order by 2 desc, c.id
      limit 20
    ) as leg
  ),
  fused as (
    select
      coalesce(v.id, l.id) as id,
      coalesce(1.0 / (60 + v.rank), 0)
        + coalesce(1.0 / (60 + l.rank), 0) as score
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
    f.score::double precision
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc, c.id
  limit greatest(coalesce(match_count, 8), 0);
$$;

comment on function public.search_chunks(text, extensions.vector, int) is
  'Hybrid retrieval (SPEC §5): pgvector cosine top-20 + spanish FTS top-20 fused with RRF (k=60). Service-role only; consumed by #21 (/api/ask) and #25 (eval).';

revoke all on function public.search_chunks(text, extensions.vector, int)
  from public, anon, authenticated;

grant execute on function public.search_chunks(text, extensions.vector, int)
  to service_role;
