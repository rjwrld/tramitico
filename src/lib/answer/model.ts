/**
 * Model selection for the two model calls on the ask path. Lives in its own
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

export function getAnswerModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL);
}

export function getCondenseModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.CONDENSE_MODEL ?? DEFAULT_CONDENSE_MODEL);
}
