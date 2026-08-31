/**
 * One document's trip from extracted paragraphs to rows: chunk → guard →
 * embed → persist (SPEC §4).
 *
 * It lives here rather than inside `scripts/ingest.ts`'s loop because the
 * guard is only worth as much as its wiring (#206): the acceptance criterion
 * is that a recrawl whose extraction recovered no text *fails before writing
 * anything*, and that is a claim about the order of these four steps, not
 * about any one of them. A seam the runner calls is a seam a unit test can
 * call too. Fetching stays outside — that switch is all network, `pdftotext`
 * and manifest quirks, and has nothing to say about this order.
 */
import {
  assertChunksCarryContent,
  chunkDocument,
  type ChunkOptions,
} from "./chunker";
import {
  persistDocument,
  type DocumentRowClient,
  type ReplaceRpcClient,
} from "./replace";

/** What ingesting one document needs of a manifest entry. */
export interface IngestableDocument {
  doc_key: string;
  title: string;
  norma: string | null;
  source: unknown;
  effective_date?: string | null;
  chunking?: ChunkOptions;
}

/** The slice of `Embedder` a document ingest uses — the batched one. */
export interface DocumentEmbedder {
  provider: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface IngestDeps {
  client: DocumentRowClient & ReplaceRpcClient;
  embedder: DocumentEmbedder;
  /** Clock for the freshness stamp; overridable so a test can assert it. */
  now?: () => string;
}

/**
 * Chunks handed to `embed` at a time. The embedder does its own
 * provider-aware batching underneath (token budgets, pacing); this only keeps
 * a 1,500-chunk reglamento from arriving as one array.
 */
const EMBED_BATCH = 64;

/**
 * Ingest `paragraphs` as `doc`, returning the number of chunks written.
 *
 * Throws — writing nothing — if the paragraphs carry no content, so a broken
 * extraction can never reach `replace_chunks` and delete the document's real
 * chunks on its way to a green run.
 */
export async function ingestDocument(
  deps: IngestDeps,
  doc: IngestableDocument,
  paragraphs: string[],
): Promise<number> {
  const chunks = chunkDocument(
    doc.doc_key,
    doc.title,
    paragraphs,
    doc.chunking ?? {},
  );
  assertChunksCarryContent(doc.doc_key, chunks);

  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    embeddings.push(
      ...(await deps.embedder.embed(
        chunks.slice(i, i + EMBED_BATCH).map((c) => c.content),
      )),
    );
  }

  await persistDocument(
    deps.client,
    {
      doc_key: doc.doc_key,
      title: doc.title,
      norma: doc.norma,
      source: doc.source,
      effective_date: doc.effective_date ?? null,
    },
    {
      fetched_at: (deps.now ?? (() => new Date().toISOString()))(),
      embedding_provider: deps.embedder.provider,
      embedding_dim: deps.embedder.dimensions,
    },
    chunks,
    embeddings,
  );

  return chunks.length;
}
