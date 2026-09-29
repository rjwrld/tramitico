/**
 * Replaying a committed groundedness transcript against today's prompt (#451).
 *
 * A full lane re-runs retrieval, and retrieval does not repeat itself: the
 * two Sonnet 5.5 arms of 2026-09-28, run the same evening on the same corpus,
 * put the same chunk list in front of the model on 11 of 27 Tier 1 cases. A
 * prompt change read off two such runs is read through that noise, and about
 * half of that run's "new" Tier 1 misses turned out to be a chunk the other
 * arm had and this one did not.
 *
 * A replay holds the chunks fixed. Each row of a transcript already carries
 * its numbered chunk list — the one the recorded answer was written from —
 * so rebuilding the prompt from it and asking the answer model again changes
 * only what the replay was run to change: the prompt, the model or the
 * effort. (Derived figures are re-resolved from those chunks with today's
 * definitions, as the route would.) The same judges then score the new
 * answer, and `coverageDelta` compares it with the row's recorded read.
 *
 * What a replay is not: a measurement of the pipeline. It says nothing about
 * retrieval, and a transcript's chunk list is one draw of it, so a replay's
 * count is a comparison against that draw, never a gate. The gates are the
 * full lane's (`groundedness.eval.test.ts`).
 */
import type { RetrievedChunk } from "../retrieval";
import { requirementCoverage, type AdequacyMisses } from "./adequacy";
import type { EvalCase, Tier } from "./dataset";
import type { TranscriptRow } from "./transcript";

/** What a transcript row leaves out of a chunk and the prompt header needs. */
export interface ChunkDocMeta {
  title: string;
  norma: string | null;
}

/**
 * The row's chunk list as `formatChunks` numbered it for the recorded prompt.
 *
 * `docTitle` and `norma` are in the prompt's `[n]` header but not in a
 * transcript row, so they come from the corpus by chunk id. A chunk id the
 * corpus no longer carries throws: a re-ingest mints new ids, and filling the
 * header from anything else would put a different prompt in front of the
 * model while the replay's output claimed the recorded one.
 */
export function replayChunks(
  row: Pick<TranscriptRow, "id" | "chunks">,
  meta: ReadonlyMap<string, ChunkDocMeta>,
): RetrievedChunk[] {
  const markers = row.chunks.map((chunk) => chunk.marker).sort((a, b) => a - b);
  if (markers.some((marker, i) => marker !== i + 1)) {
    throw new Error(
      `${row.id}: markers ${markers.join(",")} do not run 1..${markers.length} — ` +
        `rebuilding would renumber the [n] the recorded answer cites`,
    );
  }
  const absent = row.chunks
    .filter((chunk) => !meta.has(chunk.chunkId))
    .map((chunk) => chunk.chunkId);
  if (absent.length > 0) {
    throw new Error(
      `${row.id}: chunk(s) not in the corpus: ${absent.join(", ")} — ` +
        `the transcript predates a re-ingest, so its prompt cannot be rebuilt`,
    );
  }
  return [...row.chunks]
    .sort((a, b) => a.marker - b.marker)
    .map((chunk) => {
      const doc = meta.get(chunk.chunkId)!;
      return {
        chunkId: chunk.chunkId,
        docKey: chunk.docKey,
        docTitle: doc.title,
        norma: doc.norma,
        articulo: chunk.articulo,
        path: [],
        part: 0,
        content: chunk.content,
        source: {},
        fetchedAt: null,
        score: 0,
        vectorRank: null,
        lexicalRank: null,
      };
    });
}

export function parseTranscript(jsonl: string): TranscriptRow[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TranscriptRow);
}

export interface ReplayItem {
  row: TranscriptRow;
  evalCase: EvalCase;
}

/**
 * The rows a replay answers again, each with its case, in transcript order.
 *
 * A row with no chunks is a weak-retrieval decline, which made no model call
 * and has no prompt to replay. Every mismatch throws before any paid call,
 * naming the id: a named case the transcript does not carry is a typo that
 * would buy a smaller replay than asked for, a row whose case the dataset
 * dropped has no requirements to judge, and a selection that leaves nothing
 * would buy an empty summary.
 */
export function replayPlan(
  rows: readonly TranscriptRow[],
  dataset: readonly EvalCase[],
  { cases, tier }: { cases: readonly string[] | null; tier: Tier | null },
): ReplayItem[] {
  if (cases !== null) {
    const unknown = cases.filter((id) => !rows.some((r) => r.id === id));
    if (unknown.length > 0) {
      throw new Error(`not in the transcript: ${unknown.join(", ")}`);
    }
  }
  const plan = rows
    .filter((row) => row.chunks.length > 0)
    .filter((row) => cases === null || cases.includes(row.id))
    .filter((row) => tier === null || row.tier === tier)
    .map((row) => {
      const evalCase = dataset.find((c) => c.id === row.id);
      if (evalCase === undefined) {
        throw new Error(`${row.id}: not in eval/dataset.jsonl`);
      }
      return { row, evalCase };
    });
  if (plan.length === 0) throw new Error("nothing to replay in that selection");
  return plan;
}

/** One case's recorded and replayed adequacy read. */
export interface CoverageItem {
  evalCase: EvalCase;
  before: AdequacyMisses;
  after: AdequacyMisses;
}

export interface CoverageDelta {
  before: { stated: number; total: number };
  after: { stated: number; total: number };
  cases: { id: string; before: number; after: number; total: number }[];
}

/**
 * Requirements stated by the recorded answer and by the replayed one, per
 * case and summed — `requirementCoverage`'s count (#287), read twice over the
 * same cases.
 */
export function coverageDelta(items: readonly CoverageItem[]): CoverageDelta {
  const cases = items.map(({ evalCase, before, after }) => {
    const replayed = requirementCoverage([{ evalCase, adequacy: after }]);
    return {
      id: evalCase.id,
      before: requirementCoverage([{ evalCase, adequacy: before }]).stated,
      after: replayed.stated,
      total: replayed.total,
    };
  });
  return {
    before: requirementCoverage(
      items.map(({ evalCase, before }) => ({ evalCase, adequacy: before })),
    ),
    after: requirementCoverage(
      items.map(({ evalCase, after }) => ({ evalCase, adequacy: after })),
    ),
    cases,
  };
}
