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
import type { PinName } from "../answer/pins";
import type { RerankReadingCount } from "../answer/rerank";
import type { RetrievedChunk } from "../retrieval";
import type { GenerationFinishReason } from "../telemetry";
import type { AnswerChecks } from "./answer-checks";
import type { EvalCase, Family, Tier, Variant } from "./dataset";
import type { FailureLabelling, Verdict } from "./groundedness";

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
  /**
   * What put it past the cut, when something did (#579): a step pick or one
   * of `pinAnswerSet`'s appends. Absent on the cut's own chunks, and on every
   * chunk of a transcript written before #579.
   */
  pin?: PinName;
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
  derivedFigures: TranscriptFigure[];
  groundedness: TranscriptGroundedness;
  /** `null` on a weak-retrieval decline, which ships without markers. */
  citations: CitationVerdict | null;
  /** `null` on a case that declares no requirements. */
  adequacy: {
    verdict: Verdict;
    missing: string[];
    literals: string[];
  } | null;
  /**
   * How the answer call ended and what it spent, so a run can size the
   * output cap: thinking counts toward it, and only the provider's total
   * says how close an answer came — and the date it was written against.
   * `null` on a weak-retrieval decline, which calls no model.
   */
  generation: TranscriptGeneration | null;
  /**
   * How the rerank's readings fared for this case (#466): asked, came back,
   * and each one lost with its cause and HTTP status. A lost reading changes
   * the chunk list above without changing any text, so a row that lost one
   * was answered on a different set than a clean run would have given it.
   * `null` when the rerank never called Voyage — a weak-retrieval decline,
   * `RERANK=off`, no key. Absent from transcripts written before #466.
   */
  rerank: RerankReadingCount | null;
  /**
   * #500's checks on the answer: the absence claims the corpus index
   * contradicts (each one fails the case), the opening absence claim and the
   * typo runs (reported). `null` on a weak-retrieval decline, which is a
   * fixed text. Absent from transcripts written before #500.
   */
  checks: AnswerChecks | null;
  /**
   * The two further answers a blocking case is asked when its first fails
   * (#474), judged and checked like the first: the case's groundedness is
   * read on all three (`blockingCaseVerdict`). Empty on every other case;
   * absent from transcripts written before #474.
   */
  reasks?: TranscriptReask[];
}

/** One answer's groundedness reading. */
export interface TranscriptGroundedness {
  verdict: Verdict;
  verdicts: Verdict[];
  reason: string;
  /**
   * The label a separate judge call gave a failure the judges made (#474):
   * recorded, never gated. `null` when the judges passed the answer — one
   * failed only by #500's absence gate too. Absent before #474.
   */
  label?: FailureLabelling | null;
}

/** A derived figure the prompt carried, by id and as the answer quotes it. */
export interface TranscriptFigure {
  id: string;
  formattedValue: string;
}

/** A re-asked answer (#474): the parts of a row that belong to one answer. */
export interface TranscriptReask {
  query: string;
  answer: string;
  chunks: TranscriptChunk[];
  derivedFigures: TranscriptFigure[];
  groundedness: TranscriptGroundedness;
  citations: CitationVerdict | null;
  checks: AnswerChecks | null;
  generation: TranscriptGeneration | null;
  rerank: RerankReadingCount | null;
}

export interface TranscriptGeneration {
  finishReason: GenerationFinishReason;
  /** Thinking included; `null` if the provider reported no count. */
  outputTokens: number | null;
  /**
   * The Costa Rica date the prompt gave the model, `YYYY-MM-DD` (#455): «ese
   * plazo ya pasó» is right or wrong only against it. Absent from
   * transcripts written before #455, whose prompts carried no date.
   */
  today: string;
}

export interface ReaskInput {
  query: string;
  answer: string;
  chunks: readonly RetrievedChunk[];
  derivedFigures: readonly ResolvedDerivedFigure[];
  groundedness: TranscriptGroundedness;
  citations: CitationVerdict | null;
  checks: AnswerChecks | null;
  generation: TranscriptGeneration | null;
  rerank: RerankReadingCount | null;
  /** Which pin brought each chunk past the cut, by chunk id (#579). */
  pins?: ReadonlyMap<string, PinName>;
}

export interface TranscriptInput {
  evalCase: EvalCase;
  query: string;
  answer: string;
  chunks: readonly RetrievedChunk[];
  derivedFigures: readonly ResolvedDerivedFigure[];
  groundedness: TranscriptGroundedness;
  citations: CitationVerdict | null;
  adequacy: { verdict: Verdict; missing: string[]; literals: string[] } | null;
  generation: TranscriptGeneration | null;
  rerank: RerankReadingCount | null;
  checks: AnswerChecks | null;
  /** Which pin brought each chunk past the cut, by chunk id (#579). */
  pins?: ReadonlyMap<string, PinName>;
  /** #474's re-asks; none unless the lane asked them. */
  reasks?: readonly ReaskInput[];
}

/** The chunk list as the prompt numbered it. */
function transcriptChunks(
  chunks: readonly RetrievedChunk[],
  pins: ReadonlyMap<string, PinName> = new Map(),
): TranscriptChunk[] {
  return chunks.map((chunk, i) => {
    const pin = pins.get(chunk.chunkId);
    return {
      marker: i + 1,
      chunkId: chunk.chunkId,
      docKey: chunk.docKey,
      articulo: chunk.articulo,
      content: chunk.content,
      ...(pin === undefined ? {} : { pin }),
    };
  });
}

function transcriptFigures(
  derivedFigures: readonly ResolvedDerivedFigure[],
): TranscriptFigure[] {
  return derivedFigures.map((figure) => ({
    id: figure.id,
    formattedValue: figure.formattedValue,
  }));
}

/** A row written today always carries the label, `null` when there is none. */
function transcriptGroundedness({
  label = null,
  ...reading
}: TranscriptGroundedness): TranscriptGroundedness {
  return { ...reading, label };
}

/**
 * Runs a paid lane's phases in order, then `record` — whatever happened. A
 * phase that throws stops the phases after it, `record` still writes what
 * the earlier ones produced, and the error is rethrown after it: a provider
 * 5xx or a judge's malformed reply on case 60 must not take the 59 paid rows
 * before it along (#474). `record` owns its own failures; see the lane's
 * transcript write.
 */
export async function runThenRecord(
  phases: readonly (() => Promise<void>)[],
  record: () => void,
): Promise<void> {
  let failed = false;
  let failure: unknown;
  try {
    for (const phase of phases) await phase();
  } catch (error) {
    failed = true;
    failure = error;
  }
  record();
  if (failed) throw failure;
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
  generation,
  rerank,
  checks,
  pins,
  reasks = [],
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
    chunks: transcriptChunks(chunks, pins),
    derivedFigures: transcriptFigures(derivedFigures),
    groundedness: transcriptGroundedness(groundedness),
    citations,
    adequacy,
    generation,
    rerank,
    checks,
    // Field by field: a caller may hand over a wider object than a re-ask.
    reasks: reasks.map((reask) => ({
      query: reask.query,
      answer: reask.answer,
      chunks: transcriptChunks(reask.chunks, reask.pins),
      derivedFigures: transcriptFigures(reask.derivedFigures),
      groundedness: transcriptGroundedness(reask.groundedness),
      citations: reask.citations,
      checks: reask.checks,
      generation: reask.generation,
      rerank: reask.rerank,
    })),
  };
}

/**
 * One line for a run's console: how many rerank readings the run lost, and
 * on which cases, with each loss's reading and status (#466). A full lane
 * paces far under the rate #457 saw Voyage reject, but only this line shows
 * that a given run lost none. `null` rows (no rerank) are not counted.
 */
export function droppedReadingsSummary(
  cases: readonly { id: string; rerank: RerankReadingCount | null }[],
): string {
  const ran = cases.flatMap(({ id, rerank }) =>
    rerank === null ? [] : [{ id, rerank }],
  );
  const asked = ran.reduce((n, { rerank }) => n + rerank.asked, 0);
  const lossy = ran.filter(({ rerank }) => rerank.dropped.length > 0);
  const lost = lossy.reduce((n, { rerank }) => n + rerank.dropped.length, 0);
  if (lost === 0) return `rerank readings lost: none of ${asked}`;
  const detail = lossy.map(
    ({ id, rerank }) =>
      `${id}(${rerank.dropped
        .map(({ reading, cause, status }) =>
          cause === "http" ? `${reading}:${status}` : `${reading}:${cause}`,
        )
        .join(",")})`,
  );
  return (
    `rerank readings lost: ${lost} of ${asked}, on ${lossy.length} ` +
    `case(s) — ${detail.join(" ")}`
  );
}

/** JSONL: one row per line, newline-terminated. `JSON.stringify` escapes the
 * newlines inside an answer, so a row is always exactly one line. */
export function serializeTranscript(rows: readonly TranscriptRow[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

/**
 * `groundedness-<answer model>[-subset]-<instant>.jsonl`. The instant is what
 * keeps two runs of the same model from overwriting each other — comparing a
 * run against the previous one is the point of keeping them.
 *
 * `subset` is there for the same reason (#289): a run scoped by `EVAL_CASES`
 * covers the cases someone named and says nothing about the rest, so the file
 * it leaves behind must not read, a week later, as the full run it sits beside.
 */
export function transcriptFilename(
  answerModel: string,
  now: Date,
  { subset = false }: { subset?: boolean } = {},
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const model = answerModel.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `groundedness-${model}${subset ? "-subset" : ""}-${stamp}.jsonl`;
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
    subset = false,
  }: { dir?: string; answerModel: string; now?: Date; subset?: boolean },
): string {
  mkdirSync(dir, { recursive: true });
  const name = transcriptFilename(answerModel, now, { subset });
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
