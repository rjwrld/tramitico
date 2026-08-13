/**
 * Adversarial conflicting-sources case (issue #135, decision on #121).
 *
 * The corpus has annual decree churn — tramos, BMC, wage figures — and one
 * day two ingested documents will state different numbers for the same thing.
 * The launch behavior is that the *answer text* surfaces the discrepancy
 * (structured vigencia extraction, which would let the pipeline decide which
 * one rules, is post-launch per #121). Rule 4 of ANSWER_SYSTEM_PROMPT encodes
 * that; this file is the case that proves it.
 *
 * The fragments are hand-written on purpose. Retrieval can only return what
 * the corpus holds, and the corpus is — deliberately — not self-contradictory,
 * so a real question cannot exercise this path. `eval/dataset.jsonl` therefore
 * stays out of it: its targets are contractually verified against the ingested
 * corpus. The two fragments below are shaped like the documents that would
 * actually collide (a tramos decree superseded by the next year's) and differ
 * in exactly one figure, so a judge can check the answer names both.
 *
 * The judge is a second one, distinct from the groundedness judge: that judge
 * asks whether every claim is supported, and an answer that quietly picked one
 * of the two figures would pass it. This one asks the adversarial question —
 * is the disagreement itself stated, with both numbers and both citations?
 */
import { generateText } from "ai";
import type { RetrievedChunk } from "../retrieval";
import { formatChunks } from "../answer/prompt";
import {
  getJudgeModel,
  JUDGE_TEMPERATURE,
  parseJudgeVerdict,
  type JudgeOnce,
} from "./groundedness";

/** The question both fragments answer — and answer differently. */
export const CONFLICT_QUESTION =
  "¿Cuál es el tramo exento del impuesto sobre la renta para trabajadores independientes?";

/**
 * Two official-looking fragments that disagree on one figure and on nothing
 * else. Both are fabrications for this case: no such decree amounts are
 * claimed to be current, and this fixture never touches the corpus.
 */
export const CONFLICT_CHUNKS: RetrievedChunk[] = [
  {
    chunkId: "conflict-a",
    docKey: "tramos-renta-2026",
    docTitle: "Decreto de tramos del impuesto sobre la renta 2026",
    norma: "Decreto Ejecutivo 44000",
    articulo: "Artículo 1",
    path: [],
    part: 0,
    content:
      "Las rentas de las personas físicas con actividad lucrativa estarán " +
      "exentas hasta un monto anual de ¢4.094.000. El exceso se grava según " +
      "los tramos siguientes.",
    source: { url: "https://www.hacienda.go.cr/tramos-2026" },
    fetchedAt: "2026-01-15T10:00:00Z",
    score: 0.03,
    vectorRank: 1,
    lexicalRank: 1,
  },
  {
    chunkId: "conflict-b",
    docKey: "tramos-renta-2025",
    docTitle: "Decreto de tramos del impuesto sobre la renta 2025",
    norma: "Decreto Ejecutivo 43500",
    articulo: "Artículo 1",
    path: [],
    part: 0,
    content:
      "Las rentas de las personas físicas con actividad lucrativa estarán " +
      "exentas hasta un monto anual de ¢3.947.000. El exceso se grava según " +
      "los tramos siguientes.",
    source: { url: "https://www.hacienda.go.cr/tramos-2025" },
    fetchedAt: "2025-01-20T10:00:00Z",
    score: 0.029,
    vectorRank: 2,
    lexicalRank: 2,
  },
];

/** The figures the answer has to keep apart, in fragment order. */
export const CONFLICT_FIGURES = ["4.094.000", "3.947.000"] as const;

export const CONFLICT_JUDGE_SYSTEM_PROMPT = `You are an adversarial judge for a Costa Rican tax/trámite assistant. You are given a user question, two numbered official fragments that deliberately CONTRADICT each other on one figure, and the assistant's answer (in Spanish).

Decide only one thing: does the answer surface the contradiction to the reader?

It passes only if all three hold:
- It says, in its own words, that the official sources disagree / are not consistent on this figure. Merely listing two numbers without saying they conflict is NOT enough.
- It states both figures.
- It cites both fragments with their [n] markers.

It fails if the answer picks one figure, averages or reconciles them silently, presents one as superseding the other without the fragments saying so, or answers as if there were no conflict.

Do not judge style, completeness, or whether the answer is otherwise helpful.

Respond with only a JSON object, no other text:
{"verdict": "pass" | "fail", "reason": "<one short sentence>"}`;

/** Question + the contradicting fragments + the answer under judgement. */
export function buildConflictJudgePrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
): string {
  return (
    `Pregunta:\n${question}\n\n` +
    `Fragmentos oficiales provistos (se contradicen):\n\n${formatChunks(chunks)}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

/**
 * One conflict-judge call, shaped as a `JudgeOnce` so it drops straight into
 * `judgeAnswer`'s judge → re-judge → majority orchestration (SPEC §9) instead
 * of duplicating it.
 */
export const conflictJudgeOnce: JudgeOnce = async (
  question,
  chunks,
  answer,
) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: CONFLICT_JUDGE_SYSTEM_PROMPT,
    prompt: buildConflictJudgePrompt(question, chunks, answer),
    temperature: JUDGE_TEMPERATURE,
  });
  return parseJudgeVerdict(text);
};
