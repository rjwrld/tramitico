/**
 * Groundedness judge (SPEC §9, issue #26): judge model config, prompt
 * assembly, verdict parsing, and judgeAnswer() — the judge → re-judge →
 * majority orchestration the eval uses. The orchestration takes an
 * injectable judgeOnce so the branching stays unit-testable; only the
 * default judgeOnce touches the model. Since #474 it also holds the gates'
 * shape — a tracked baseline, the blocking 2-of-3 rule — and the recorded,
 * ungated label on a failed answer.
 *
 * The question the judge answers: "is this answer supported by the retrieved
 * chunks?" — the same chunks the production route handed the answer model.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel } from "ai";
import type { RetrievedChunk } from "../retrieval";
import {
  incompletelyCitedDerivedFigures,
  type ResolvedDerivedFigure,
} from "../answer/derived";
import type { CitationVerdict } from "../answer/invariant";
import { formatChunks, formatDerivedFigures } from "../answer/prompt";
import type { AnswerChecks } from "./answer-checks";

/**
 * Groundedness is a tracked baseline, not a rate gate (#474, ADR 0023's
 * amendment). It started as ≥90% (#14) and ratcheted to ≥94% on the 2026
 * baseline (#267, 70/73); from 2026-09-24 every full lane sat at 67–70 of
 * 73, so 69 passed and 68 failed and a run read green or red on one case.
 * Now a lane counts its grounded answers against the baseline, as Tier 1
 * does (`TIER1_REQUIREMENT_BASELINE`): 68 of 73, the 2026-10-02 lane.
 *
 * #511's baseline lane read 72 of 74 (eval/runs/2026-10-08-baseline/), and
 * the owner held the baseline at 68 rather than ratchet it (2026-10-08). It
 * was one lane, its Tier 1 +16 is unexplained with the prompt unchanged, and
 * the pipeline changes again before #512, whose two lanes re-set it.
 */
export const GROUNDEDNESS_BASELINE = 68;

/**
 * The cases the lane counts over: every non-abstention case outside the
 * robustness block. A count means nothing over a population nobody chose, so
 * a dataset change that moves this says so here in the same change
 * (`groundedness.test.ts` reads the dataset).
 *
 * 74 since #503 added `t2-inscripcion-dimex`. The baseline and the floor stay
 * absolute counts of grounded answers: the 68 was read over the 73 before it,
 * and a new case can only add a pass. #511 was the first lane read over 74
 * (72). #512's final lanes re-set the baseline over the population they run.
 */
export const GROUNDEDNESS_CASES = 74;

/** Tier 1's margin (#457's ±4), held for the same run-to-run noise. */
export const GROUNDEDNESS_REGRESSION_MARGIN = 4;

/**
 * The fewest grounded answers a full lane may score: 64, so a lane at 63 or
 * below fails. A lane that beats the baseline raises it (the ratchet); #512's
 * two final lanes re-set it.
 */
export const GROUNDEDNESS_FLOOR =
  GROUNDEDNESS_BASELINE - GROUNDEDNESS_REGRESSION_MARGIN;

/**
 * The judge is pinned, not ANSWER_MODEL: the Sonnet-vs-Haiku comparison only
 * means something if both face the same judge. Pinned to Sonnet 4.5 rather
 * than Sonnet 5 because SPEC §9 requires the judge to run at temperature 0
 * and Sonnet 5 rejects non-default sampling parameters (ADR 0007).
 */
export const JUDGE_MODEL = "claude-sonnet-4-5";
export const JUDGE_TEMPERATURE = 0;

/** Mirror of getAnswerModel(), minus the env override: the judge is pinned. */
export function getJudgeModel(): LanguageModel {
  return createAnthropic()(JUDGE_MODEL);
}

/** Failed items are re-judged this many extra times; majority verdict stands. */
export const REJUDGE_COUNT = 2;

export type Verdict = "pass" | "fail";

export interface JudgeVerdict {
  verdict: Verdict;
  reason: string;
}

export const JUDGE_SYSTEM_PROMPT = `You are a strict groundedness judge for a Costa Rican tax/trámite assistant. You are given a user question, the numbered official fragments and any system-calculated figures the assistant was allowed to use, and the assistant's answer (in Spanish).

Decide only one thing: is every factual claim in the answer supported by the provided fragments?

Rules:
- Every fact, figure, monto, porcentaje, tramo, plazo, or legal requirement stated in the answer must appear in the fragments or in the system-calculated figures. Paraphrase is fine; invention, extrapolation, or arithmetic not present in that material is not.
- Citation markers like [n] must reference provided fragment numbers, and the cited fragment must actually support the adjacent claim.
- An answer that honestly declines — saying it finds no official basis and referring the user to Hacienda or the CCSS — is grounded: it makes no unsupported claims.
- The stock statement that the Código de Trabajo generally does not apply to independent workers is an encoded product fact and does not require fragment support.
- Judge support, not quality: an incomplete but fully supported answer passes; a helpful answer with one unsupported claim fails.

Respond with only a JSON object, no other text:
{"verdict": "pass" | "fail", "reason": "<one short sentence>"}`;

/** Question + the exact numbered fragments the answer model saw + the answer. */
export function buildJudgePrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
  derivedFigures: readonly ResolvedDerivedFigure[] = [],
): string {
  const derived =
    derivedFigures.length === 0
      ? ""
      : `\n\n${formatDerivedFigures(derivedFigures)}`;
  return (
    `Pregunta:\n${question}\n\n` +
    `Fragmentos oficiales provistos:\n\n${formatChunks(chunks)}${derived}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

/**
 * The first balanced `{…}` in `text`, or null.
 *
 * A greedy `/\{[\s\S]*\}/` runs to the *last* brace in the response, so a
 * judge that prints its object and then a sentence containing a brace hands
 * the parser the object plus that prose, and `JSON.parse` fails on text that
 * had a perfectly good object at the front of it. Counting depth — and
 * skipping braces inside strings, where a `reason` may quote one — takes the
 * object and stops. Shared by every judge parser: #311's pin1 arm lost its
 * groundedness lane to exactly this reply shape.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Extract the judge's JSON verdict. Tolerates fenced code blocks and
 * surrounding prose (first `{...}` object wins); throws on anything that
 * isn't a well-formed verdict so a misbehaving judge fails loudly instead of
 * counting as a pass or fail.
 */
export function parseJudgeVerdict(text: string): JudgeVerdict {
  const object = firstJsonObject(text);
  if (object === null) {
    throw new Error(`judge output has no JSON object: ${text.slice(0, 200)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(object);
  } catch (cause) {
    throw new Error(`judge output is malformed JSON: ${object.slice(0, 200)}`, {
      cause,
    });
  }
  const entry = raw as { verdict?: unknown; reason?: unknown };
  if (entry.verdict !== "pass" && entry.verdict !== "fail") {
    throw new Error(`judge verdict must be "pass" or "fail": ${object}`);
  }
  return {
    verdict: entry.verdict,
    reason: typeof entry.reason === "string" ? entry.reason : "",
  };
}

/** Majority of an odd-length verdict list (SPEC §9: 1 judge + 2 re-judges). */
export function majorityVerdict(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) {
    throw new Error("majorityVerdict: empty verdict list");
  }
  const passes = verdicts.filter((v) => v === "pass").length;
  return passes * 2 > verdicts.length ? "pass" : "fail";
}

/** One judge call. Injectable so judgeAnswer's branching is unit-testable. */
export type JudgeOnce = (
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
  derivedFigures?: readonly ResolvedDerivedFigure[],
) => Promise<JudgeVerdict>;

const realJudgeOnce: JudgeOnce = async (
  question,
  chunks,
  answer,
  derivedFigures = [],
) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgePrompt(question, chunks, answer, derivedFigures),
    temperature: JUDGE_TEMPERATURE,
  });
  return parseJudgeVerdict(text);
};

/**
 * SPEC §9 judge orchestration: judge once; on a fail, re-judge REJUDGE_COUNT
 * more times and let the majority stand (absorbs judge flakiness without
 * loosening the gate). The reason is the last failing one, so a fail verdict
 * always carries a fail explanation. Judge errors propagate — a misbehaving
 * judge fails loudly instead of counting as a pass or fail.
 */
export async function judgeAnswer(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
  judgeOnce: JudgeOnce = realJudgeOnce,
  derivedFigures: readonly ResolvedDerivedFigure[] = [],
): Promise<{ verdict: Verdict; verdicts: Verdict[]; reason: string }> {
  const first = await judgeOnce(question, chunks, answer, derivedFigures);
  const verdicts: Verdict[] = [first.verdict];
  let reason = first.reason;
  if (first.verdict === "fail") {
    for (let i = 0; i < REJUDGE_COUNT; i++) {
      const again = await judgeOnce(question, chunks, answer, derivedFigures);
      verdicts.push(again.verdict);
      if (again.verdict === "fail") reason = again.reason;
    }
  }
  return { verdict: majorityVerdict(verdicts), verdicts, reason };
}

/**
 * What a failed answer got wrong, as a second call to the pinned judge reads
 * it (#474). Recorded in every failing row and never gated: the 2026-10-07
 * audit split the judges' fails into real errors and strict calls on
 * reasonable inferences, and the label becomes a gate only if it agrees with a
 * human read of #512's failures. A call of its own, not a field added to
 * `JUDGE_SYSTEM_PROMPT`, so the verdicts the baseline counts are asked
 * exactly as they were when it was measured.
 */
export type FailureLabel = "contradiction" | "inference";

export interface FailureLabelling {
  /** `null` when the call failed or answered out of shape: see `labelFailure`. */
  label: FailureLabel | null;
  reason: string;
}

export const FAILURE_LABEL_SYSTEM_PROMPT = `A strict groundedness judge has failed an answer from a Costa Rican tax/trámite assistant. You are given the user question, the numbered official fragments and any system-calculated figures the assistant was allowed to use, the assistant's answer (in Spanish), and the judge's reason for failing it.

Label the failure with exactly one category:
- "contradiction": the answer says something the fragments contradict or do not contain at all — a wrong or invented figure, monto, porcentaje, plazo or requirement; a citation [n] whose fragment does not say what the adjacent claim says; a URL, office, channel or step that appears in no fragment; or a statement that the fragments lack something they in fact contain.
- "inference": every fact the judge objected to is in the fragments, and the answer combines, applies or restates them in a way a careful reader could defend, though no fragment says it in those words — including an accurate remark that the fragments do not cover a point.

Read the fragments yourself; do not take the judge's reason as settled.

Respond with only a JSON object, no other text:
{"label": "contradiction" | "inference", "reason": "<one short sentence>"}`;

/** The judge's prompt, plus the reason the judges failed the answer. */
export function buildFailureLabelPrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
  judgeReason: string,
  derivedFigures: readonly ResolvedDerivedFigure[] = [],
): string {
  return (
    `${buildJudgePrompt(question, chunks, answer, derivedFigures)}\n\n` +
    `Motivo del juez:\n${judgeReason}`
  );
}

/** The labelling call's JSON, or a throw on anything out of shape. */
export function parseFailureLabel(text: string): FailureLabelling {
  const object = firstJsonObject(text);
  if (object === null) {
    throw new Error(`label output has no JSON object: ${text.slice(0, 200)}`);
  }
  const entry = JSON.parse(object) as { label?: unknown; reason?: unknown };
  if (entry.label !== "contradiction" && entry.label !== "inference") {
    throw new Error(`label must be "contradiction" or "inference": ${object}`);
  }
  return {
    label: entry.label,
    reason: typeof entry.reason === "string" ? entry.reason : "",
  };
}

/** One labelling call: the prompt in, the model's raw text out. Injectable. */
export type LabelOnce = (prompt: string) => Promise<string>;

const realLabelOnce: LabelOnce = async (prompt) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: FAILURE_LABEL_SYSTEM_PROMPT,
    prompt,
    temperature: JUDGE_TEMPERATURE,
  });
  return text;
};

/**
 * Labels one failed answer. Unlike the verdict, an error here is recorded
 * rather than thrown: the label gates nothing, and a full lane is half an
 * hour of paid calls, so a label the call could not give reads `null`, with
 * the error as its reason, and the run goes on.
 */
export async function labelFailure(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
  judgeReason: string,
  derivedFigures: readonly ResolvedDerivedFigure[] = [],
  labelOnce: LabelOnce = realLabelOnce,
): Promise<FailureLabelling> {
  try {
    return parseFailureLabel(
      await labelOnce(
        buildFailureLabelPrompt(
          question,
          chunks,
          answer,
          judgeReason,
          derivedFigures,
        ),
      ),
    );
  } catch (error) {
    return { label: null, reason: `not labelled: ${String(error)}` };
  }
}

/**
 * How many more answers the lane asks for a blocking case whose first answer
 * failed (#474): two, so the case is read on three answers. Over 14
 * committed full lanes, re-judging the 88 first-judge fails flipped 2 to
 * pass; the variance is in the answer, so the second and third readings are
 * new answers, not new judges.
 */
export const BLOCKING_REASK_COUNT = 2;

/** One scored answer to a case: the lane's first, or a re-ask. */
export interface ScoredAnswer {
  /**
   * The judges' verdict, failed by #500's absence gate or by anything the
   * route would refuse to ship (`scoreAnswer`).
   */
  verdict: Verdict;
  reason: string;
  /** #500: the answer says the documents lack what the corpus carries. */
  falseAbsence: boolean;
}

/** One answer as the lane holds it: what `scoreAnswer` reads. */
export interface AnswerToScore {
  /** After #500's absence gate (`withAbsenceGate`). */
  verdict: Verdict;
  reason: string;
  answer: string;
  /** `null` on a weak-retrieval decline, which ships without markers. */
  citations: CitationVerdict | null;
  derivedFigures: readonly ResolvedDerivedFigure[];
  /** `null` on a weak-retrieval decline, a fixed text. */
  checks: AnswerChecks | null;
}

/**
 * One answer as #474's blocking rule reads it. An answer the route would
 * refuse to ship — a marker that resolves to nothing or no marker at all
 * (#168), or a derived figure without its inputs (#281) — fails, whatever
 * the judges said: otherwise a re-ask production would never show could be
 * one of the two passing answers that clear a case. The lane's zero gates
 * for both read first answers only, so this is where a re-ask meets them.
 * (An orchestrator call on #521, beyond the owner's decision.)
 *
 * A weak-retrieval decline passes, as it does on a first answer: the fixed
 * text makes no claim.
 */
export function scoreAnswer(scored: AnswerToScore): ScoredAnswer {
  const falseAbsence = (scored.checks?.absence.falseClaims.length ?? 0) > 0;
  if (scored.verdict === "fail") {
    return { verdict: "fail", reason: scored.reason, falseAbsence };
  }
  if (scored.citations !== null && !scored.citations.ok) {
    return {
      verdict: "fail",
      reason: `the route would refuse it (#168): ${scored.citations.violation}`,
      falseAbsence,
    };
  }
  const uncited = incompletelyCitedDerivedFigures(
    scored.answer,
    scored.derivedFigures,
  );
  if (uncited.length > 0) {
    return {
      verdict: "fail",
      reason: `derived figures without their inputs (#281): ${uncited.join(", ")}`,
      falseAbsence,
    };
  }
  return { verdict: "pass", reason: scored.reason, falseAbsence };
}

/** The slice of a judged case the per-case gate reads. */
export interface BlockingCase {
  evalCase: { id: string; blocking: boolean };
  /** The first answer, then its re-asks, in order. */
  answers: readonly ScoredAnswer[];
}

/**
 * Whether the lane re-asks a case: blocking, and its first answer failed for
 * any reason but a false absence claim. That one has already decided the
 * case (see `blockingCaseVerdict`), so asking again could buy nothing.
 */
export function needsReask({ evalCase, answers }: BlockingCase): boolean {
  const [first] = answers;
  return (
    evalCase.blocking &&
    answers.length === 1 &&
    first.verdict === "fail" &&
    !first.falseAbsence
  );
}

/**
 * A blocking case's verdict (#474): it fails when two of its three answers
 * fail. A first answer that passes is the case's only answer and settles it.
 *
 * #500's hard zero wins over the 2-of-3 reading: a false absence claim fails
 * the case on whichever answer shows it, and is never re-sampled away. Both
 * rules guard a reader, but a «no está en los documentos» about something the
 * corpus carries is a wrong statement a deterministic check proved, not a
 * judge's call that another answer might not repeat.
 *
 * Throws on a failing case read without its re-asks, so a lane that forgot
 * them fails loudly instead of passing the case on one answer.
 */
export function blockingCaseVerdict(answers: readonly ScoredAnswer[]): Verdict {
  if (answers.some((answer) => answer.falseAbsence)) return "fail";
  const failed = answers.filter((answer) => answer.verdict === "fail").length;
  if (failed === 0) return "pass";
  if (answers.length < 1 + BLOCKING_REASK_COUNT) {
    throw new Error(
      `a failing blocking case is read on ${1 + BLOCKING_REASK_COUNT} ` +
        `answers; got ${answers.length}`,
    );
  }
  return failed * 2 > answers.length ? "fail" : "pass";
}

/**
 * The per-case half of SPEC §9's groundedness rule (#324): a blocking case
 * may not fail. The aggregate gate held 70/73 on the 2026-09-11 closing run
 * while two Tier 1 held-out cases failed unanimously — wrong statements, not
 * missing ones — and the lane passed, because it only asserted the rate.
 * Since #474 a case fails on two of three answers (`blockingCaseVerdict`).
 * A failure is named by id, with the reasons, so the eval output says which
 * case and why. Pure, so the rule is unit-tested without a provider.
 */
export function blockingGroundednessFailures(
  results: readonly BlockingCase[],
): string[] {
  return results
    .filter(
      (r) => r.evalCase.blocking && blockingCaseVerdict(r.answers) === "fail",
    )
    .map(({ evalCase, answers }) => {
      const absent = answers.findIndex((answer) => answer.falseAbsence);
      if (absent !== -1) {
        return `${evalCase.id} (answer ${absent + 1}: ${answers[absent].reason})`;
      }
      const failed = answers.filter((answer) => answer.verdict === "fail");
      return (
        `${evalCase.id} (${failed.length} of ${answers.length} answers: ` +
        `${failed.map((answer) => answer.reason).join(" | ")})`
      );
    });
}
