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
  type Chunk,
  type ChunkOptions,
} from "./chunker";
import type { YearFigure } from "../vigencia";
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
  /** Artículos stating one fiscal year's figures (#518). */
  yearFigures?: readonly YearFigure[];
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
  return ingestChunks(deps, doc, chunks);
}

/** Persist already-structured chunks from extractors whose source supplies
 * its own citation boundary (the CCSS FAQ's question/modal pairs). */
export async function ingestChunks(
  deps: IngestDeps,
  doc: IngestableDocument,
  chunks: Chunk[],
): Promise<number> {
  assertChunksCarryContent(doc.doc_key, chunks);
  assertYearFigureEvidence(doc.doc_key, chunks, doc.yearFigures ?? []);

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

/**
 * Throws — before anything is embedded or written — unless every
 * `yearFigures` artículo is still in the crawl and each of its chunks carries
 * its evidence (#518). Retrieval matches a listed artículo by its heading, so
 * a heading the publisher renamed would let the figure through unlisted; and
 * it serves only chunks carrying the evidence, so a crawl that moved to a new
 * year under the old declaration would ingest text withheld for good. Either
 * way the manifest and the text have parted, and the owner re-reads the
 * source before the run can go on (runbook §2.2).
 */
export function assertYearFigureEvidence(
  docKey: string,
  chunks: readonly Chunk[],
  yearFigures: readonly YearFigure[],
): void {
  for (const figure of yearFigures) {
    const own = chunks.filter((chunk) => chunk.articulo === figure.articulo);
    if (own.length === 0) {
      throw new Error(
        `${docKey}: yearFigures lists «${figure.articulo}», but the crawl has no chunk with that heading — re-read the source and update the manifest (#518)`,
      );
    }
    const lacking = own.filter(
      (chunk) => !chunk.content.includes(figure.evidence),
    );
    if (lacking.length > 0) {
      throw new Error(
        `${docKey}: «${figure.articulo}» part(s) ${lacking.map((chunk) => chunk.part).join(", ")} no longer carry «${figure.evidence}», the evidence for its ${figure.fiscalYear} figures — if the source moved to a new year, set fiscalYear and evidence to match it (#518, runbook §2.2)`,
      );
    }
  }
}
