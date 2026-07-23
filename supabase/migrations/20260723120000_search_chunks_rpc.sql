-- Hybrid retrieval RPC (SPEC §5, issue #20): pgvector cosine leg + Spanish FTS
-- leg fused with reciprocal rank fusion (k=60). SECURITY INVOKER — callers need
-- their own SELECT rights on chunks/documents, so this is only usable with the
-- service role (RLS on both tables has no policy granting anon/authenticated
-- SELECT). EXECUTE is revoked from PUBLIC/anon/authenticated below so the
-- Data API never exposes it.

CREATE OR REPLACE FUNCTION "public"."search_chunks"(
  "query_text" "text",
  "query_embedding" "extensions"."vector",
  "match_count" integer DEFAULT 8
) RETURNS TABLE(
  "chunk_id" "uuid",
  "doc_key" "text",
  "doc_title" "text",
  "norma" "text",
  "articulo" "text",
  "path" "text"[],
  "part" integer,
  "content" "text",
  "source" "jsonb",
  "score" double precision
)
LANGUAGE "sql" STABLE SECURITY INVOKER
SET "search_path" = "public", "extensions"
AS $$
  WITH vector_leg AS (
    SELECT c.id AS chunk_id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rnk
    FROM public.chunks c
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT 20
  ),
  lexical_leg AS (
    SELECT c.id AS chunk_id,
           row_number() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('spanish', query_text)) DESC) AS rnk
    FROM public.chunks c
    WHERE c.tsv @@ websearch_to_tsquery('spanish', query_text)
    ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('spanish', query_text)) DESC
    LIMIT 20
  ),
  fused AS (
    SELECT chunk_id, sum(1.0 / (60 + rnk)) AS score
    FROM (
      SELECT * FROM vector_leg
      UNION ALL
      SELECT * FROM lexical_leg
    ) legs
    GROUP BY chunk_id
  )
  SELECT
    c.id AS chunk_id,
    d.doc_key,
    d.title AS doc_title,
    d.norma,
    c.articulo,
    c.path,
    c.part,
    c.content,
    d.source,
    f.score
  FROM fused f
  JOIN public.chunks c ON c.id = f.chunk_id
  JOIN public.documents d ON d.id = c.document_id
  ORDER BY f.score DESC
  LIMIT match_count;
$$;

ALTER FUNCTION "public"."search_chunks"("text", "extensions"."vector", integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."search_chunks"("text", "extensions"."vector", integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."search_chunks"("text", "extensions"."vector", integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."search_chunks"("text", "extensions"."vector", integer) FROM "authenticated";
GRANT ALL ON FUNCTION "public"."search_chunks"("text", "extensions"."vector", integer) TO "service_role";
