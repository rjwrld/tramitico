/**
 * Question condensation — how multi-turn works here (issue #132, ADR 0012).
 *
 * The UI has always implied a conversation while the API took one question at
 * a time, so "¿y si también soy asalariado?" arrived with its antecedent
 * stripped off and retrieved against nothing. The decision on #121 is true
 * multi-turn *without* a second answering path: one small model call rewrites
 * the follow-up and the recent turns into a single standalone Spanish
 * question, and that question then feeds the existing pipeline verbatim —
 * retrieval, rerank, the groundedness prompt, the citation invariant, all
 * unchanged and all still reasoning about exactly one question.
 *
 * Three properties this module is built around:
 *
 * 1. **A first turn costs nothing.** No history means no call, no latency, no
 *    tokens, and byte-for-byte the behavior single-turn asks had before.
 * 2. **It can never block an ask.** Every failure — a provider outage, the
 *    timeout, an empty or absurd rewrite — falls back to the raw question.
 *    A degraded follow-up is what the product did last week; a failed ask is
 *    a regression. Nothing in here throws at its caller.
 * 3. **Its cost is flat.** The window is bounded before the prompt is built
 *    (`boundTurns`, contract.ts) and the output is capped, so condensing the
 *    thirtieth turn of a thread costs what condensing the second one does.
 *
 * Observability follows the established detail-line pattern
 * (`retrieval-degraded.ts`): an in-process tally the tests read plus a
 * `console.warn` on a stable prefix a log drain can count. The per-ask event
 * in `telemetry.ts` is a closed vocabulary and a privacy claim (runbook §1),
 * so it is not extended here.
 *
 * Nothing in this module logs a question, a turn, or a rewrite: prior turns
 * are question text, and question text never reaches a log (#136).
 */
import { generateText } from "ai";
import { boundTurns, type ConversationTurn } from "./contract";
import { getCondenseModel } from "./model";
import { describeError } from "../log-redaction";

/**
 * How long a condensation may take before the raw question wins (#132 req.
 * 4). Four seconds against the route's 60 s budget: the call is a couple of
 * hundred tokens on the smallest model, so a slow one is a sick one, and
 * every second spent waiting is a second the reader spends staring at
 * "buscando" for an ask that was going to work anyway.
 */
export const CONDENSE_TIMEOUT_MS = 4_000;

/**
 * Output cap for the rewrite. One question in Spanish, generously — enough
 * for a compound follow-up carrying two antecedents, far short of a model
 * that has started explaining itself instead of rewriting.
 */
export const CONDENSE_MAX_OUTPUT_TOKENS = 200;

/**
 * Longest rewrite we will accept, in characters. Matches the route's own
 * question limit: whatever comes back has to be usable as a question, and a
 * question the route would have rejected on the way in is not.
 */
export const MAX_CONDENSED_LENGTH = 1_000;

export const CONDENSE_SYSTEM_PROMPT = `Usted reescribe preguntas de seguimiento para un buscador de documentos oficiales de Costa Rica (Hacienda y CCSS).

Recibe los últimos intercambios de una conversación y la pregunta nueva. Devuelve una sola pregunta autónoma en español, que se entienda por sí sola, sin la conversación al lado.

Reglas:

1. Devuelva únicamente la pregunta reescrita. Sin comillas, sin encabezados, sin explicaciones, sin texto antes o después.
2. Resuelva lo que la pregunta nueva da por supuesto: pronombres, «eso», «ahí», «y si…», y el tema del que se venía hablando. Tome ese tema de los intercambios anteriores.
3. No agregue datos, cifras, artículos, nombres de leyes ni condiciones que no estén en la conversación. Usted no responde: solo reformula.
4. Conserve la intención y el alcance de la pregunta nueva. No la amplíe ni la reduzca.
5. Si la pregunta nueva ya se entiende por sí sola, devuélvala tal cual.
6. Una sola pregunta, en una sola línea, tratando a la persona de usted.`;

/**
 * The turns and the follow-up, labeled. Prior answers are included but were
 * already clamped by `boundTurns`: what the rewrite needs from an answer is
 * its subject matter, which is in its first lines.
 */
export function buildCondensePrompt(
  question: string,
  turns: readonly ConversationTurn[],
): string {
  const history = turns
    .map(
      (turn, i) =>
        `Intercambio ${i + 1}\nPersona: ${turn.question}\nAsistente: ${turn.answer}`,
    )
    .join("\n\n");
  return (
    `Conversación anterior:\n\n${history}\n\n` +
    `Pregunta nueva:\n${question}\n\n` +
    `Pregunta autónoma:`
  );
}

/**
 * Why a condensation did not produce a question we could use.
 *
 * - `timeout` — the budget expired; the provider is slow or unreachable.
 * - `error` — anything else the provider answered with (a 429, a 5xx).
 * - `unusable` — a completed call whose output was empty or over the length
 *   cap. Worth splitting from `error`: it is a prompt or model problem, not
 *   an availability one, and the two call for different fixes.
 */
export type CondenseFailure = "timeout" | "error" | "unusable";

export type CondenseFailureCounts = Record<CondenseFailure, number>;

const counts: CondenseFailureCounts = { timeout: 0, error: 0, unusable: 0 };

/** Snapshot of the tally. A copy — callers cannot write through it. */
export function condenseFailures(): CondenseFailureCounts {
  return { ...counts };
}

/** Test-only: puts the tally back to zero between cases. */
export function resetCondenseFailures(): void {
  counts.timeout = 0;
  counts.error = 0;
  counts.unusable = 0;
}

/**
 * Classifies a rejection the same way `degradedReason` does, and for the same
 * reason: `AbortSignal.timeout` aborts with a `TimeoutError`, some runtimes
 * report the abort as `AbortError`, and both mean the budget is what stopped
 * us.
 */
export function condenseFailureReason(error: unknown): CondenseFailure {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "error";
}

/**
 * Records one fallback to the raw question. The prefix is load-bearing: it is
 * what a log-based counter matches on, so it is a constant string with the
 * variables tacked on as `key=value`. `error=` is `describeError`'s token and
 * nothing else — the question, the turns and the rewrite never appear.
 */
export function recordCondenseFailure(
  reason: CondenseFailure,
  error?: unknown,
): void {
  counts[reason] += 1;
  console.warn(
    `ask: condensation failed — reason=${reason} ` +
      `error=${error === undefined ? "none" : describeError(error)}`,
  );
}

/**
 * The result of asking for a standalone question.
 *
 * `query` is what the pipeline runs on — the rewrite when there is one, the
 * raw question otherwise, so a caller never has to decide. `condensed` is the
 * rewrite alone, and `null` says "the pipeline ran on the literal question":
 * a first turn, a skipped call, or a fallback. That is exactly the value the
 * history row stores beside the user's own words (#132 req. 3), which is why
 * it is nullable rather than defaulting to a copy of the question — a column
 * full of duplicates would say nothing about whether condensation ran.
 */
export interface CondensedQuestion {
  query: string;
  condensed: string | null;
}

export interface CondenseOptions {
  /** Test seam; defaults to `CONDENSE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Strips what a model puts around a one-line answer even when told not to:
 * surrounding quotes, a stray label, trailing whitespace, and any second
 * paragraph it decided to add. Cheap insurance — the alternative is a
 * retrieval query with `"` in it.
 */
export function cleanCondensed(raw: string): string {
  const firstLine = raw.trim().split("\n")[0]?.trim() ?? "";
  const unquoted = firstLine
    .replace(/^["“'«]+/, "")
    .replace(/["”'»]+$/, "")
    .trim();
  return unquoted.replace(/\s+/g, " ");
}

/**
 * Rewrites `question` into a standalone one against `turns`, or gives the
 * question back unchanged.
 *
 * Returns rather than throws on every path. The one behavior a caller must be
 * able to rely on is that this cannot fail an ask.
 */
export async function condenseQuestion(
  question: string,
  turns: readonly unknown[] = [],
  { timeoutMs = CONDENSE_TIMEOUT_MS }: CondenseOptions = {},
): Promise<CondensedQuestion> {
  const bounded = boundTurns(turns);
  // The first-turn skip (#132 req. 2), and the whole of it: no model, no
  // client, no timer. A single-question ask is byte-for-byte what it was.
  if (bounded.length === 0) return { query: question, condensed: null };

  let text: string;
  try {
    const result = await generateText({
      model: getCondenseModel(),
      system: CONDENSE_SYSTEM_PROMPT,
      prompt: buildCondensePrompt(question, bounded),
      temperature: 0,
      maxOutputTokens: CONDENSE_MAX_OUTPUT_TOKENS,
      // The timeout alone, not the request's own signal: a reader who presses
      // stop during condensation is handled by the route's abort checks
      // further down, and wiring their abort in here would only turn a
      // deliberate stop into a logged condensation failure.
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    text = result.text;
  } catch (error) {
    recordCondenseFailure(condenseFailureReason(error), error);
    return { query: question, condensed: null };
  }

  const condensed = cleanCondensed(text);
  if (condensed === "" || condensed.length > MAX_CONDENSED_LENGTH) {
    recordCondenseFailure("unusable");
    return { query: question, condensed: null };
  }
  return { query: condensed, condensed };
}
