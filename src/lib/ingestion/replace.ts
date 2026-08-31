/**
 * Atomic wholesale chunk replacement (ADR 0002, issue #59).
 *
 * The delete-and-reinsert itself lives in Postgres: `replace_chunks` clears a
 * document's chunks and inserts the new set inside one function call — one
 * transaction — so a crash mid-ingest can never strand a document with zero or
 * partial chunks. This module pairs chunks with their embeddings and calls that
 * RPC through a client interface narrow enough that tests hand in a fake
 * (the `RetrievalRpcClient` pattern, `src/lib/retrieval.ts`).
 *
 * {@link persistDocument} sits on top of it and owns the *order* the two
 * writes happen in, which is the part a runner must not get wrong (#206).
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

/** The `documents` columns that describe *which* document this is. */
export interface DocumentIdentity {
  doc_key: string;
  title: string;
  norma: string | null;
  source: unknown;
  effective_date: string | null;
}

/** The `documents` columns that describe *this run* of the ingestion. */
export interface DocumentStamp {
  fetched_at: string;
  embedding_provider: string;
  embedding_dim: number;
}

/**
 * The slice of `SupabaseClient` the `documents` row writes need — the same
 * narrowing {@link ReplaceRpcClient} does for the RPC, so the ordering below
 * can be asserted against a fake instead of only against a live database.
 */
export interface DocumentRowClient {
  from(table: "documents"): {
    upsert(
      values: DocumentIdentity,
      options: { onConflict: "doc_key" },
    ): {
      select(columns: "id"): {
        single(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(values: DocumentStamp): {
      eq(
        column: "id",
        value: string,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Write one document and its chunks, stamping freshness last (#206).
 *
 * The order is the whole point. `fetched_at` is a claim that the chunks
 * standing in the table were extracted from the source at that moment, and
 * `search_chunks` returns it for the UI to date a citation with — so it must
 * only be written once the chunks it describes are actually in place. Doing
 * the identity upsert first is safe (it renames nothing a reader dates its
 * answer by) and gets us the `id` that `replace_chunks` needs; a failure
 * anywhere after it leaves the previous run's chunks and the previous run's
 * `fetched_at` — consistent with each other, and honestly stale.
 *
 * Returns the number of chunks inserted.
 */
export async function persistDocument(
  client: DocumentRowClient & ReplaceRpcClient,
  identity: DocumentIdentity,
  stamp: DocumentStamp,
  chunks: readonly ReplaceableChunk[],
  embeddings: readonly number[][],
): Promise<number> {
  const { data, error } = await client
    .from("documents")
    .upsert(identity, { onConflict: "doc_key" })
    .select("id")
    .single();
  if (error) {
    throw new Error(`${identity.doc_key}: upsert document — ${error.message}`);
  }
  const documentId = (data as { id: string }).id;

  const inserted = await replaceDocumentChunks(
    client,
    documentId,
    chunks,
    embeddings,
  );

  const { error: stampError } = await client
    .from("documents")
    .update(stamp)
    .eq("id", documentId);
  if (stampError) {
    throw new Error(
      `${identity.doc_key}: stamp document — ${stampError.message}`,
    );
  }
  return inserted;
}
