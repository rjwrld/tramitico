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
import type { DatedFact, OverriddenFigure, YearFigure } from "../vigencia";
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
  /** Artículos stating a fact that ends on a given day (#531). */
  datedFacts?: readonly DatedFact[];
  /** Artículos stating figures a later law has overridden (#529). */
  overriddenFigures?: readonly OverriddenFigure[];
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
  assertDatedFactEvidence(doc.doc_key, chunks, doc.datedFacts ?? []);
  assertOverriddenFigureEvidence(
    doc.doc_key,
    chunks,
    doc.overriddenFigures ?? [],
  );

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
    assertArticuloCarries(docKey, chunks, figure, {
      missing: `yearFigures lists «${figure.articulo}», but the crawl has no chunk with that heading — re-read the source and update the manifest (#518)`,
      lacking: `the evidence for its ${figure.fiscalYear} figures — if the source moved to a new year, set fiscalYear and evidence to match it (#518, runbook §2.2)`,
    });
  }
}

/**
 * The same refusal for `datedFacts` (#531). A heading the publisher renamed
 * would let a deadline through unlisted after its day; a text that no longer
 * states the listed day has moved it — an extension, most often — and the
 * owner sets `lastDay` and `evidence` to the new one before the run goes on.
 * A fact past its day whose answer the publisher took down fails here too:
 * its manifest entry is retired, not kept (runbook §2.4).
 */
export function assertDatedFactEvidence(
  docKey: string,
  chunks: readonly Chunk[],
  datedFacts: readonly DatedFact[],
): void {
  for (const fact of datedFacts) {
    assertArticuloCarries(docKey, chunks, fact, {
      missing: `datedFacts lists «${fact.articulo}», but the crawl has no chunk with that heading — if its day (${fact.lastDay}) has passed and the source dropped it, retire the entry; otherwise re-read the source and update the manifest (#531, runbook §2.4)`,
      lacking: `the evidence for its last day, ${fact.lastDay} — if the source moved the date, set lastDay and evidence to match it (#531, runbook §2.4)`,
    });
  }
}

/**
 * The same refusal for `overriddenFigures` (#529), with the evidence read the
 * other way: retrieval withholds the chunks that carry the overridden words,
 * so the crawl must still have the artículo, and at least one of its chunks
 * must still carry them. A heading the publisher renamed would let the
 * overridden figure through unlisted. A text that dropped the words has
 * most often been brought in line with the later law, and the entry is
 * retired — but the owner reads it first, since a reworded figure would also
 * pass (runbook §2.5).
 */
export function assertOverriddenFigureEvidence(
  docKey: string,
  chunks: readonly Chunk[],
  overriddenFigures: readonly OverriddenFigure[],
): void {
  for (const { articulo, evidence } of overriddenFigures) {
    const own = articuloChunks(
      docKey,
      chunks,
      articulo,
      `overriddenFigures lists «${articulo}», but the crawl has no chunk with that heading — re-read the source and update the manifest (#529, runbook §2.5)`,
    );
    if (!own.some((chunk) => chunk.content.includes(evidence))) {
      throw new Error(
        `${docKey}: «${articulo}» no longer carries «${evidence}» — if the publisher brought it in line with the later law, retire the entry; if it reworded the figure, set evidence to the new words (#529, runbook §2.5)`,
      );
    }
  }
}

/** Throws unless the crawl has `articulo` and each of its chunks carries `evidence`. */
function assertArticuloCarries(
  docKey: string,
  chunks: readonly Chunk[],
  { articulo, evidence }: { articulo: string; evidence: string },
  messages: { missing: string; lacking: string },
): void {
  const own = articuloChunks(docKey, chunks, articulo, messages.missing);
  const lacking = own.filter((chunk) => !chunk.content.includes(evidence));
  if (lacking.length > 0) {
    throw new Error(
      `${docKey}: «${articulo}» part(s) ${lacking.map((chunk) => chunk.part).join(", ")} no longer carry «${evidence}», ${messages.lacking}`,
    );
  }
}

/** The crawl's chunks under `articulo`; throws `missing` when there are none. */
function articuloChunks(
  docKey: string,
  chunks: readonly Chunk[],
  articulo: string,
  missing: string,
): Chunk[] {
  const own = chunks.filter((chunk) => chunk.articulo === articulo);
  if (own.length === 0) {
    throw new Error(`${docKey}: ${missing}`);
  }
  return own;
}
