/**
 * The committed corpus index (issue #163): the distinct
 * `(docKey, articulo, path)` triples present in `public.chunks` after an
 * ingestion run, dumped to `eval/corpus-index.json`, each with the number of
 * chunks and of distinct `part`s behind it (#274).
 *
 * Why it exists: the satisfiability census (#111) asserts every target in
 * `eval/dataset.jsonl` is matched by at least one ingested chunk. That is a
 * question about *coverage*, not about embeddings — but answering it against
 * the real table needs a corpus, and building a corpus needs the paid
 * embedder the per-PR lane is defined by not having. So a PR that edits the
 * dataset used to get no automated census at all. This fixture carries just
 * the columns `chunkMatchesTarget` reads, which makes the census a pure unit
 * test: a PR adding an unsatisfiable target goes red with no database and no
 * secrets.
 *
 * The trade is drift — the fixture goes stale when the corpus changes and
 * nobody re-dumps it. `scripts/ingest.ts` rewrites it on every run so the
 * common path can't drift, and the eval-lane census (against the real table,
 * which also compares the two) is the backstop for the uncommon one.
 */
import path from "node:path";
import { articuloKey, fold } from "../articulo-key";
import type { MatchableChunk } from "./dataset";

export const CORPUS_INDEX_PATH = path.join(
  process.cwd(),
  "eval",
  "corpus-index.json",
);

/** A chunk as the census reads it: the matchable triple plus its `part`, the
 * fourth column of the key a chunk's citation is supposed to identify (#274). */
export interface CensusChunk extends MatchableChunk {
  part: number;
}

/**
 * One distinct triple, with the two counts that make the uniqueness invariant
 * checkable from the dump alone (#274). A well-formed corpus splits a triple
 * into `part` 0…n-1 and nothing else, so `chunks` and `parts` agree; they
 * diverge exactly when two chunks were labelled with the same citation — one
 * artículo ingested under its neighbour's número.
 */
export interface CorpusIndexEntry extends MatchableChunk {
  /** Rows in `public.chunks` carrying this triple. */
  chunks: number;
  /** Distinct `part` values among them. */
  parts: number;
}

export interface CorpusIndex {
  /** ISO timestamp of the ingestion run that produced this dump. */
  generatedAt: string;
  /** Rows in `public.chunks` at dump time — context for a stale-looking index. */
  chunkCount: number;
  /** Distinct `(docKey, articulo, path)` triples, in a stable order. */
  entries: CorpusIndexEntry[];
}

function entryKey(chunk: MatchableChunk): string {
  return JSON.stringify([chunk.docKey, chunk.articulo, chunk.path]);
}

/** An entry rendered for an assertion message. */
export function describeEntry(entry: MatchableChunk): string {
  const parts = [entry.docKey, entry.articulo ?? "(sin artículo)"];
  if (entry.path.length > 0) parts.push(`@${entry.path.join(" › ")}`);
  return parts.join(" · ");
}

/**
 * The entries whose `(docKey, articulo, path, part)` key is carried by more
 * than one chunk — distinct artículos sharing one citation (#274).
 */
export function collidingEntries(index: CorpusIndex): CorpusIndexEntry[] {
  return index.entries.filter((entry) => entry.chunks !== entry.parts);
}

/** One citable label of one document, whatever its path. */
export interface RepeatedLabel {
  docKey: string;
  articulo: string;
}

/**
 * A label a document carries under two paths, where the source really does
 * (#530). Each needs its reason: the guard below exists because a repeated
 * label is usually a chunking bug, not a quirk of the source.
 */
export interface AllowedRepeatedLabel extends RepeatedLabel {
  reason: string;
}

export const ALLOWED_REPEATED_LABELS: readonly AllowedRepeatedLabel[] = [
  {
    docKey: "ccss-faq",
    articulo:
      "¿Qué hago si voy a salir del país por un periodo de tiempo mayor a tres meses?",
    reason:
      "CCSS asks it under «Seguro voluntario» and «Trabajador Independiente» and answers it differently in each (identical answers are deduped, #301); dataset targets pick one with pathIncludes",
  },
  {
    docKey: "ccss-faq",
    articulo: "¿Si me atraso en el pago debo pagar intereses?",
    reason:
      "CCSS asks it under «Seguro voluntario» and «Trabajador Independiente» and answers it differently in each (identical answers are deduped, #301)",
  },
];

/** A label rendered for an assertion message. */
export function describeLabel({ docKey, articulo }: RepeatedLabel): string {
  return `${docKey} · ${articulo}`;
}

/**
 * Two labels are one when #508's resolver would take them for one artículo
 * (`articuloKey`: «Artículo 4», «ARTICULO 04»); any other label, a
 * transitorio or an FAQ question, when it folds the same.
 */
function labelIdentity({ docKey, articulo }: RepeatedLabel): string {
  return JSON.stringify([
    docKey,
    articuloKey(articulo) ?? fold(articulo).trim(),
  ]);
}

/**
 * The labels carried under more than one path, in index order (#530). A
 * citation names a label, not a path, and the resolver refuses a label two
 * artículos share, so one mislabelled chunk costs every reference to the real
 * artículo. Unlabelled entries and an artículo's parts are not repeats.
 */
export function repeatedLabels(index: CorpusIndex): RepeatedLabel[] {
  const seen = new Map<string, RepeatedLabel>();
  const repeated = new Map<string, RepeatedLabel>();
  for (const { docKey, articulo } of index.entries) {
    if (articulo === null) continue;
    const label = { docKey, articulo };
    const identity = labelIdentity(label);
    const first = seen.get(identity);
    if (first) repeated.set(identity, first);
    else seen.set(identity, label);
  }
  return [...repeated.values()];
}

/**
 * The index's repeats against `ALLOWED_REPEATED_LABELS`: those no entry
 * allows, and entries no repeat needs any more (a fixed chunker's re-dump
 * retires the entry that tided it over, as #530's did).
 */
export function auditRepeatedLabels(index: CorpusIndex): {
  unallowed: RepeatedLabel[];
  stale: AllowedRepeatedLabel[];
} {
  const repeated = repeatedLabels(index);
  const repeatedIds = new Set(repeated.map(labelIdentity));
  const allowedIds = new Set(ALLOWED_REPEATED_LABELS.map(labelIdentity));
  return {
    unallowed: repeated.filter(
      (label) => !allowedIds.has(labelIdentity(label)),
    ),
    stale: ALLOWED_REPEATED_LABELS.filter(
      (allowed) => !repeatedIds.has(labelIdentity(allowed)),
    ),
  };
}

/** Distinct triples in a deterministic order, so a re-dump of an unchanged
 * corpus produces a byte-identical file and only real drift shows in a diff. */
export function buildCorpusIndex(
  chunks: readonly CensusChunk[],
  generatedAt: string,
): CorpusIndex {
  const distinct = new Map<string, CorpusIndexEntry>();
  const seenParts = new Map<string, Set<number>>();
  for (const chunk of chunks) {
    const key = entryKey(chunk);
    const entry = distinct.get(key) ?? {
      docKey: chunk.docKey,
      articulo: chunk.articulo,
      path: [...chunk.path],
      chunks: 0,
      parts: 0,
    };
    const parts = seenParts.get(key) ?? new Set<number>();
    parts.add(chunk.part);
    entry.chunks += 1;
    entry.parts = parts.size;
    seenParts.set(key, parts);
    distinct.set(key, entry);
  }
  const entries = [...distinct.values()].sort((a, b) =>
    entryKey(a).localeCompare(entryKey(b)),
  );
  return { generatedAt, chunkCount: chunks.length, entries };
}

export function serializeCorpusIndex(index: CorpusIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/**
 * The dump as the repo commits it: prettier's JSON layout, so a re-dump passes
 * `format:check` without a separate `--write`.
 */
export async function formatCorpusIndex(index: CorpusIndex): Promise<string> {
  const { format, resolveConfig } = await import("prettier");
  const options = await resolveConfig(CORPUS_INDEX_PATH);
  return format(serializeCorpusIndex(index), {
    ...options,
    filepath: CORPUS_INDEX_PATH,
  });
}

/**
 * Whether two dumps record the same coverage. `generatedAt` says when a dump
 * was taken, not what it holds, so it is left out: an ingest that changes no
 * coverage leaves the committed file alone.
 */
export function sameCoverage(a: CorpusIndex, b: CorpusIndex): boolean {
  return (
    a.chunkCount === b.chunkCount &&
    JSON.stringify(a.entries) === JSON.stringify(b.entries)
  );
}

export function parseCorpusIndex(json: string): CorpusIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new Error("corpus index: malformed JSON", { cause });
  }
  const index = raw as Partial<CorpusIndex>;
  if (typeof index.generatedAt !== "string" || index.generatedAt === "") {
    throw new Error("corpus index: missing generatedAt");
  }
  if (typeof index.chunkCount !== "number") {
    throw new Error("corpus index: missing chunkCount");
  }
  if (!Array.isArray(index.entries) || index.entries.length === 0) {
    throw new Error("corpus index: missing entries");
  }
  for (const entry of index.entries as CorpusIndexEntry[]) {
    if (typeof entry.docKey !== "string" || entry.docKey === "") {
      throw new Error("corpus index: entry missing docKey");
    }
    if (typeof entry.articulo !== "string" && entry.articulo !== null) {
      throw new Error(`corpus index: ${entry.docKey} entry missing articulo`);
    }
    if (
      !Array.isArray(entry.path) ||
      entry.path.some((element) => typeof element !== "string")
    ) {
      throw new Error(
        `corpus index: ${entry.docKey} entry has a non-string path`,
      );
    }
    for (const count of ["chunks", "parts"] as const) {
      if (!Number.isInteger(entry[count]) || entry[count] < 1) {
        throw new Error(`corpus index: ${entry.docKey} entry missing ${count}`);
      }
    }
  }
  return index as CorpusIndex;
}

/** Above any plausible corpus size — the default PostgREST cap is 1000 rows,
 * and a silently truncated corpus would report false unsatisfiable targets. */
export const CHUNK_FETCH_LIMIT = 100_000;

/** The slice of `SupabaseClient` the census read needs (the `ReplaceRpcClient`
 * pattern, `src/lib/ingestion/replace.ts`). */
export interface ChunkCensusClient {
  from(table: "chunks"): {
    select(columns: string): {
      limit(count: number): PromiseLike<{
        data:
          | {
              articulo: string | null;
              path: string[];
              part: number;
              documents: { doc_key: string };
            }[]
          | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** The one census query, shared by the fixture dump and the eval-lane census
 * so the two can only ever disagree about the corpus, never about the read. */
export async function fetchCorpusChunks(
  client: ChunkCensusClient,
): Promise<CensusChunk[]> {
  const { data, error } = await client
    .from("chunks")
    .select("articulo, path, part, documents!inner(doc_key)")
    .limit(CHUNK_FETCH_LIMIT);
  if (error) throw new Error(`chunk census query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    docKey: row.documents.doc_key,
    articulo: row.articulo,
    path: row.path,
    part: row.part,
  }));
}
