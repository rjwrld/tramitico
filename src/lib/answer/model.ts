/**
 * Model selection for the model calls on the ask path. Lives in its own
 * module so route tests can swap in a mock language model.
 *
 * - `getAnswerModel` (SPEC §5): Claude Sonnet by default, overridable via
 *   ANSWER_MODEL so the Week 3 Haiku 4.5 cost/quality comparison is an env
 *   change, not a code change.
 * - `getCondenseModel` (#132): the question-condensation call, pinned to the
 *   smallest adequate model and overridable the same way. Deliberately a
 *   *separate* seam rather than a reuse of `getAnswerModel`: condensation is
 *   a rewrite with no corpus, no citations and no judgement in it, and it
 *   runs in front of every follow-up. Tying it to ANSWER_MODEL would make the
 *   Sonnet/Haiku comparison silently change the cost of multi-turn too.
 * - `getExpandModel` (#286): the query-expansion call. Same default and same
 *   argument as condensation — a rewrite with no corpus and no judgement in
 *   it — but its own seam and its own env var, because it runs in front of
 *   *every* ask rather than every follow-up. One knob that silently priced
 *   both would hide which of the two a cost change came from.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const DEFAULT_ANSWER_MODEL = "claude-sonnet-5";

/**
 * Haiku, not Sonnet: rewriting "¿y si también soy asalariado?" plus its
 * antecedent into one Spanish sentence is the cheapest kind of work a model
 * does, and the failure mode is bounded — a bad rewrite falls back to the raw
 * question (condense.ts), it does not reach the reader.
 */
export const DEFAULT_CONDENSE_MODEL = "claude-haiku-4-5";

/**
 * `||`, not `??`, in all three — the same reading `rerank.ts` gives `RERANK`.
 * `eval.yml` passes these as `${{ vars.X }}`, which interpolates an unset
 * repository variable as the **empty string**, and `??` would hand that
 * straight to `createAnthropic`, which sends `"model": ""` to Anthropic and
 * gets an error back. For the expansion that error is silent: `expandQuery`
 * catches it, returns null, and the run quietly measures the two-leg search
 * while its transcript says `expand=on`.
 */
export function getAnswerModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.ANSWER_MODEL || DEFAULT_ANSWER_MODEL);
}

export function getCondenseModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.CONDENSE_MODEL || DEFAULT_CONDENSE_MODEL);
}

export function getExpandModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.EXPAND_MODEL || DEFAULT_CONDENSE_MODEL);
}
