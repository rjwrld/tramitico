-- ADR 0003 (issue #19): pin chunks.embedding to voyage-3's 1024 dimensions
-- and index it for the cosine vector leg of search_chunks.
--
-- Existing rows carry 256d stub vectors from keyless dev — meaningless for
-- retrieval and uncastable to the new type, so they are nulled; the re-embed
-- (pnpm ingest with EMBEDDINGS_PROVIDER=voyage) repopulates every chunk.

set search_path = '';

update public.chunks set embedding = null;

alter table public.chunks
  alter column embedding type extensions.vector(1024)
  using null;

-- HNSW over cosine distance, matching the operator search_chunks uses.
create index chunks_embedding_hnsw
  on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);
