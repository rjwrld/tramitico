/**
 * Atomic wholesale chunk replacement (ADR 0002, issue #59).
 *
 * The delete-and-reinsert itself lives in Postgres: `replace_chunks` clears a
 * document's chunks and inserts the new set inside one function call — one
 * transaction — so a crash mid-ingest can never strand a document with zero or
 * partial chunks. This module pairs chunks with their embeddings and calls that
 * RPC through a client interface narrow enough that tests hand in a fake
 * (the `RetrievalRpcClient` pattern, `src/lib/retrieval.ts`).
 */

/** What a chunk row carries besides its embedding (chunker output, sans docKey). */
export interface ReplaceableChunk {
  articulo: string | null;
  path: string[];
  part: number;
  content: string;
}

/** One `p_chunks` jsonb element, wire shape mirrored by the SQL function. */
export interface ChunkRow extends ReplaceableChunk {
  embedding: number[];
}

export interface ReplaceChunksArgs {
  p_document_id: string;
  p_chunks: ChunkRow[];
}

/** The slice of `SupabaseClient` chunk replacement needs. */
export interface ReplaceRpcClient {
  rpc(
    fn: "replace_chunks",
    args: ReplaceChunksArgs,
  ): PromiseLike<{
    data: number | null;
    error: { message: string } | null;
  }>;
}

/**
 * Replace `documentId`'s chunks wholesale with `chunks` paired index-wise to
 * `embeddings`. Returns the number of chunks inserted.
 */
export async function replaceDocumentChunks(
  client: ReplaceRpcClient,
  documentId: string,
  chunks: readonly ReplaceableChunk[],
  embeddings: readonly number[][],
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `replaceDocumentChunks: ${chunks.length} chunks but ` +
        `${embeddings.length} embeddings for document ${documentId}`,
    );
  }
  const { data, error } = await client.rpc("replace_chunks", {
    p_document_id: documentId,
    p_chunks: chunks.map((c, i) => ({
      articulo: c.articulo,
      path: c.path,
      part: c.part,
      content: c.content,
      embedding: embeddings[i],
    })),
  });
  if (error) {
    throw new Error(
      `replace_chunks failed for document ${documentId}: ${error.message}`,
    );
  }
  return data ?? 0;
}
