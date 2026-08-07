/**
 * Groundedness judge (SPEC §9, issue #26): judge model config, prompt
 * assembly, verdict parsing, and judgeAnswer() — the judge → re-judge →
 * majority orchestration the eval uses. The orchestration takes an
 * injectable judgeOnce so the branching stays unit-testable; only the
 * default judgeOnce touches the model.
 *
 * The question the judge answers: "is this answer supported by the retrieved
 * chunks?" — the same chunks the production route handed the answer model.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModel } from "ai";
import type { RetrievedChunk } from "../retrieval";
import { formatChunks } from "../answer/prompt";

/**
 * Blocking gate: ≥90% of eval cases must pass the judge (starting threshold
 * per #14). Ratchet up as the pipeline improves — never lower.
 */
export const GROUNDEDNESS_GATE = 0.9;

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

export const JUDGE_SYSTEM_PROMPT = `You are a strict groundedness judge for a Costa Rican tax/trámite assistant. You are given a user question, the numbered official fragments the assistant was allowed to use, and the assistant's answer (in Spanish).

Decide only one thing: is every factual claim in the answer supported by the provided fragments?

Rules:
- Every fact, figure, monto, porcentaje, tramo, plazo, or legal requirement stated in the answer must appear in the fragments. Paraphrase is fine; invention, extrapolation, or arithmetic the fragments don't contain is not.
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
): string {
  return (
    `Pregunta:\n${question}\n\n` +
    `Fragmentos oficiales provistos:\n\n${formatChunks(chunks)}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

/**
 * Extract the judge's JSON verdict. Tolerates fenced code blocks and
 * surrounding prose (first `{...}` object wins); throws on anything that
 * isn't a well-formed verdict so a misbehaving judge fails loudly instead of
 * counting as a pass or fail.
 */
export function parseJudgeVerdict(text: string): JudgeVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`judge output has no JSON object: ${text.slice(0, 200)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch (cause) {
    throw new Error(
      `judge output is malformed JSON: ${match[0].slice(0, 200)}`,
      {
        cause,
      },
    );
  }
  const entry = raw as { verdict?: unknown; reason?: unknown };
  if (entry.verdict !== "pass" && entry.verdict !== "fail") {
    throw new Error(`judge verdict must be "pass" or "fail": ${match[0]}`);
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
) => Promise<JudgeVerdict>;

const realJudgeOnce: JudgeOnce = async (question, chunks, answer) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgePrompt(question, chunks, answer),
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
): Promise<{ verdict: Verdict; verdicts: Verdict[]; reason: string }> {
  const first = await judgeOnce(question, chunks, answer);
  const verdicts: Verdict[] = [first.verdict];
  let reason = first.reason;
  if (first.verdict === "fail") {
    for (let i = 0; i < REJUDGE_COUNT; i++) {
      const again = await judgeOnce(question, chunks, answer);
      verdicts.push(again.verdict);
      if (again.verdict === "fail") reason = again.reason;
    }
  }
  return { verdict: majorityVerdict(verdicts), verdicts, reason };
}
