/**
 * The run transcript (#289 req. 1) — reporting only, no gate.
 *
 * The 2026 baseline (#267) printed, for every inadequate case, the list of
 * requirements the judge did not find. That is enough to see *that* the answer
 * was incomplete and never enough to see *why*, because the three causes look
 * identical in that table:
 *
 * - the answer omitted a requirement the fragments carried;
 * - the fragment carrying it was never in the top-8 (retrieval / rerank);
 * - the requirement over-specifies what the corpus supports — an eval-contract
 *   defect, «a claim the corpus cannot support is not a claim».
 *
 * Telling them apart needs the answer and the numbered chunk list beside the
 * missing requirements, and the harness kept neither: classifying a run meant
 * paying for another one. So every case writes a row here, and the run leaves
 * a JSONL behind that the next classification read can work from offline.
 *
 * A row is deliberately flat and self-contained: one line per case, the
 * chunk list numbered exactly as `formatChunks` numbered it for the prompt,
 * so a `[n]` marker in `answer` indexes straight into `chunks`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CitationVerdict } from "../answer/invariant";
import type { ResolvedDerivedFigure } from "../answer/derived";
import type { RetrievedChunk } from "../retrieval";
import type { EvalCase, Family, Tier, Variant } from "./dataset";
import type { Verdict } from "./groundedness";

/** Where a run writes its transcript unless `EVAL_TRANSCRIPT_DIR` says otherwise. */
export const DEFAULT_TRANSCRIPT_DIR = "eval/transcripts";

/**
 * A chunk as the prompt presented it: its marker, what it was, and what it
 * said.
 *
 * The text is here because the question this file exists to answer — was the
 * requirement's support in front of the model at all? — cannot be answered
 * from identifiers. `docKey` + `articulo` does not even identify a chunk: a
 * long artículo is split into parts that share both, so only `chunkId` tells
 * two of them apart. Carrying the content is what makes a transcript readable
 * without the corpus database beside it, which is the re-run req. 1 exists to
 * avoid.
 */
export interface TranscriptChunk {
  /** 1-based, the `[n]` the answer cites. */
  marker: number;
  chunkId: string;
  docKey: string;
  articulo: string | null;
  /** Verbatim, as `formatChunks` put it in the prompt. */
  content: string;
}

export interface TranscriptRow {
  id: string;
  tier: Tier;
  family: Family | null;
  variant: Variant | null;
  seed: string;
  heldOut: boolean;
  /** The case as written… */
  question: string;
  /** …and the standalone question the pipeline actually ran (#132). */
  query: string;
  answer: string;
  chunks: TranscriptChunk[];
  derivedFigures: { id: string; formattedValue: string }[];
  groundedness: { verdict: Verdict; verdicts: Verdict[]; reason: string };
  /** `null` on a weak-retrieval decline, which ships without markers. */
  citations: CitationVerdict | null;
  /** `null` on a case that declares no requirements. */
  adequacy: {
    verdict: Verdict;
    missing: string[];
    literals: string[];
  } | null;
}

export interface TranscriptInput {
  evalCase: EvalCase;
  query: string;
  answer: string;
  chunks: readonly RetrievedChunk[];
  derivedFigures: readonly ResolvedDerivedFigure[];
  groundedness: { verdict: Verdict; verdicts: Verdict[]; reason: string };
  citations: CitationVerdict | null;
  adequacy: { verdict: Verdict; missing: string[]; literals: string[] } | null;
}

export function transcriptRow({
  evalCase,
  query,
  answer,
  chunks,
  derivedFigures,
  groundedness,
  citations,
  adequacy,
}: TranscriptInput): TranscriptRow {
  return {
    id: evalCase.id,
    tier: evalCase.tier,
    family: evalCase.family ?? null,
    variant: evalCase.variant ?? null,
    seed: evalCase.seed,
    heldOut: evalCase.heldOut,
    question: evalCase.question,
    query,
    answer,
    chunks: chunks.map((chunk, i) => ({
      marker: i + 1,
      chunkId: chunk.chunkId,
      docKey: chunk.docKey,
      articulo: chunk.articulo,
      content: chunk.content,
    })),
    derivedFigures: derivedFigures.map((figure) => ({
      id: figure.id,
      formattedValue: figure.formattedValue,
    })),
    groundedness,
    citations,
    adequacy,
  };
}

/** JSONL: one row per line, newline-terminated. `JSON.stringify` escapes the
 * newlines inside an answer, so a row is always exactly one line. */
export function serializeTranscript(rows: readonly TranscriptRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

/**
 * `groundedness-<answer model>-<instant>.jsonl`. The instant is what keeps two
 * runs of the same model from overwriting each other — comparing a run against
 * the previous one is the point of keeping them.
 */
export function transcriptFilename(answerModel: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const model = answerModel.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `groundedness-${model}-${stamp}.jsonl`;
}

/**
 * Writes the transcript and returns the path.
 *
 * `wx` rather than the default `w`: the stamp carries no fractional seconds,
 * so two runs of one model landing in the same second would resolve to one
 * name, and the second `writeFileSync` would truncate the first away. This is
 * the product of a run that costs real money and half an hour — losing one to
 * a name collision is not a trade worth taking, so a taken name gets a
 * suffix instead.
 */
export function writeTranscript(
  rows: readonly TranscriptRow[],
  {
    dir = process.env.EVAL_TRANSCRIPT_DIR ?? DEFAULT_TRANSCRIPT_DIR,
    answerModel,
    now = new Date(),
  }: { dir?: string; answerModel: string; now?: Date },
): string {
  mkdirSync(dir, { recursive: true });
  const name = transcriptFilename(answerModel, now);
  const body = serializeTranscript(rows);
  for (let attempt = 0; ; attempt += 1) {
    const file = path.join(
      dir,
      attempt === 0 ? name : name.replace(/\.jsonl$/, `-${attempt + 1}.jsonl`),
    );
    try {
      writeFileSync(file, body, { flag: "wx" });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
