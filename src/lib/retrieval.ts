/**
 * Hybrid retrieval wrapper (SPEC §5, issue #20) around the `search_chunks`
 * RPC: embeds the query with the corpus embedder, calls the fused
 * vector+FTS function, and maps rows to typed results + citations.
 */
import { createClient } from "@supabase/supabase-js";
import { createEmbedder, type Embedder } from "./ingestion/embedder";
import type { Database } from "./database.types";

// Mirrors the source kinds `scripts/ingest.ts` writes to `documents.source`
// (ManifestDoc["source"]). Cast at the DB boundary below — ingestion is the
// sole writer, so the shape is trusted once it round-trips through Postgres.
export type Source =
  | { kind: "sinalevi"; idFichaNorma: number; idVersionNorma: number }
  | { kind: "hacienda-pdf"; url: string }
  | { kind: "cabys"; catalog: string }
  | { kind: "unresolved"; hint: string };

export interface RetrievedChunk {
  chunkId: string;
  docKey: string;
  docTitle: string;
  norma: string | null;
  articulo: string | null;
  path: string[];
  part: number;
  content: string;
  source: Source;
  score: number;
}

export interface Citation {
  docTitle: string;
  norma: string | null;
  articulo: string | null;
  url: string;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number;
}

const SINALEVI_BASE =
  "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx";

/** Derives the official source URL from a `documents.source` value. */
export function citationUrl(source: Source): string {
  switch (source.kind) {
    case "sinalevi": {
      const params = new URLSearchParams({
        param1: "NRTC",
        nValor1: "1",
        nValor2: String(source.idFichaNorma),
        nValor3: String(source.idVersionNorma),
        strTipM: "TC",
      });
      return `${SINALEVI_BASE}?${params}`;
    }
    case "hacienda-pdf":
      return source.url;
    case "cabys":
      return source.catalog;
    case "unresolved":
      throw new Error(
        `retrieval: source is unresolved (${source.hint}) — no citation URL`,
      );
    default: {
      const unreachable: never = source;
      throw new Error(
        `retrieval: cannot derive a citation URL from source ${JSON.stringify(unreachable)}`,
      );
    }
  }
}

export function citationFor(
  chunk: Pick<RetrievedChunk, "docTitle" | "norma" | "articulo" | "source">,
): Citation {
  return {
    docTitle: chunk.docTitle,
    norma: chunk.norma,
    articulo: chunk.articulo,
    url: citationUrl(chunk.source),
  };
}

/** The slice of the Supabase client `searchChunks` needs — narrow so tests
 * can inject a fake without standing up the full SupabaseClient surface. */
export interface SearchChunksClient {
  rpc: (
    fn: "search_chunks",
    args: { query_text: string; query_embedding: string; match_count: number },
  ) => PromiseLike<{
    data: Database["public"]["Functions"]["search_chunks"]["Returns"] | null;
    error: { message: string } | null;
  }>;
}

export interface SearchChunksDeps {
  supabase?: SearchChunksClient;
  embedder?: Embedder;
}

let cachedClient: SearchChunksClient | undefined;

function defaultClient(): SearchChunksClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "searchChunks: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
      );
    }
    cachedClient = createClient<Database>(url, key);
  }
  return cachedClient;
}

/**
 * Runs the fused vector+FTS search and returns typed chunks ordered by RRF
 * score, plus the top score as a weak-retrieval signal (SPEC §5 honest
 * fallback).
 */
export async function searchChunks(
  queryText: string,
  matchCount = 8,
  deps: SearchChunksDeps = {},
): Promise<RetrievalResult> {
  const supabase = deps.supabase ?? defaultClient();
  const embedder = deps.embedder ?? createEmbedder();
  const [queryEmbedding] = await embedder.embed([queryText]);

  const { data, error } = await supabase.rpc("search_chunks", {
    query_text: queryText,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
  });
  if (error) throw new Error(`search_chunks: ${error.message}`);

  const chunks: RetrievedChunk[] = (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    docKey: row.doc_key,
    docTitle: row.doc_title,
    norma: row.norma,
    articulo: row.articulo,
    path: row.path ?? [],
    part: row.part,
    content: row.content,
    source: row.source as unknown as Source,
    score: row.score,
  }));

  return { chunks, topScore: chunks[0]?.score ?? 0 };
}
