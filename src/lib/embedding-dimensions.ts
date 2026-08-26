/**
 * The one place the corpus's embedding width is written down.
 *
 * `chunks.embedding` is `extensions.vector(1024)` — pinned by ADR 0003 to
 * voyage-3's width in migration `20260804190000_embedding_vector_1024.sql`,
 * along with the HNSW cosine index built over it. pgvector compares fixed
 * dimensions strictly, so *every* vector that reaches the column or
 * `search_chunks` — an ingested chunk, a query embed, a test fixture, the
 * keyless stub — has to be exactly this wide or Postgres raises
 * `different vector dimensions`.
 *
 * It lives in its own module, not in `retrieval.ts` or `embedder.ts`, because
 * both sides of that comparison need it and the embedder must not import the
 * retrieval module it is imported by (#193).
 *
 * Changing this number is a migration, not an edit: the column, the index and
 * the whole corpus have to be re-embedded together.
 */
export const EMBEDDING_DIMENSIONS = 1024;
