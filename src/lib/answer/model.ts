/**
 * Model selection for the model calls on the ask path. Lives in its own
 * module so route tests can swap in a mock language model.
 *
 * - `getAnswerModel` (SPEC §5): Claude Sonnet by default, overridable via
 *   ANSWER_MODEL so a model comparison is an env change, not a code change.
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
import {
  createAnthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const DEFAULT_ANSWER_MODEL = "claude-sonnet-5-5";

/**
 * Haiku, not Sonnet: rewriting "¿y si también soy asalariado?" plus its
 * antecedent into one Spanish sentence is the cheapest kind of work a model
 * does, and the failure mode is bounded — a bad rewrite falls back to the raw
 * question (condense.ts), it does not reach the reader. The default for
 * expansion too (`getExpandModel`).
 *
 * Haiku 5.5 rather than 4.5: a tenth of the price ($0.10 / $0.50 per MTok
 * against $1 / $5), and faster, where expansion was already reaching its 3 s
 * timeout in eval runs. Two of its request rules matter here, and both fail
 * silently, because both calls fall back to the raw question on any error:
 * it answers a `temperature` other than 1 (or any `top_p`/`top_k` override)
 * with a 400, so neither call sends one — the old `temperature: 0` never made
 * them deterministic anyway (eval/README.md, #457) — and it thinks by
 * default, so both send `REWRITE_PROVIDER_OPTIONS`.
 */
export const DEFAULT_CONDENSE_MODEL = "claude-haiku-5-5";

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

/**
 * Output ceiling for one answer generation. Without it the provider fills in
 * the model's own maximum (128k tokens for the shipped default), so the only
 * bound on a generation's cost was the wall-clock deadline. The longest of
 * the 125 answers in the eval transcripts is ~5.6k characters (~1.6k tokens);
 * this is ~2.5× that, so a citation-compliant answer never hits it, and a
 * runaway one is cut here rather than at the deadline. Condense and expand
 * carry their own, smaller caps (`CONDENSE_MAX_OUTPUT_TOKENS`,
 * `EXPAND_MAX_OUTPUT_TOKENS`).
 *
 * Thinking counts toward it: adaptive thinking's tokens are output tokens
 * even when their text is not returned, so the headroom above the answer is
 * also the thinking budget. Here rather than in the route so the eval lanes
 * and the latency probe send the same cap — a run that omits it can never see
 * a draft production would have cut off.
 */
export const ANSWER_MAX_OUTPUT_TOKENS = 4096;

/**
 * Adaptive-thinking effort for the answer call (#356). The answer model
 * thinks adaptively when a request omits `thinking`, at effort `high`, and
 * streams no reasoning text — so the reasoning shows up as silence before the
 * first text delta: 11–28 s on five of the nine seed prompts in the
 * 2026-09-22 probe on `claude-sonnet-5`, against ~1.5 s at `medium`.
 * `claude-sonnet-5-5` recalibrates the levels (#451): at `low` it skips
 * thinking on most asks, from `medium` up it thinks briefly before nearly
 * every one. #451 measures it at `low` — 0.76 s to first text in the
 * 2026-09-28 probe — and production takes `low` from its own env var, not
 * from here.
 *
 * `ANSWER_EFFORT` sets it for a measured run or a deploy; unset, empty (what
 * `eval.yml` interpolates for an unset repository variable) and anything
 * unrecognised all mean "send nothing", which is the provider default —
 * ignored rather than trusted.
 */
export const ANSWER_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AnswerEffort = (typeof ANSWER_EFFORTS)[number];

export function answerEffort(): AnswerEffort | null {
  const raw = process.env.ANSWER_EFFORT;
  return ANSWER_EFFORTS.find((effort) => effort === raw) ?? null;
}

/**
 * The `providerOptions` every answer call passes — the route and every eval
 * lane that writes an answer, so an effort arm measures what it names rather
 * than the default. `undefined` when no effort is set.
 */
export function answerProviderOptions():
  { anthropic: { effort: AnswerEffort } } | undefined {
  const effort = answerEffort();
  return effort === null ? undefined : { anthropic: { effort } };
}

/**
 * The answer configuration as one label, for transcript names and run logs:
 * the model, plus `-effort-<level>` when one is set. Two arms that differ
 * only in effort must not leave files that read as the same run.
 */
export function answerModelLabel(): string {
  const model = process.env.ANSWER_MODEL || DEFAULT_ANSWER_MODEL;
  const effort = answerEffort();
  return effort === null ? model : `${model}-effort-${effort}`;
}

/**
 * The `providerOptions` both rewrite calls pass (condense.ts, expand.ts):
 * thinking off. Haiku 5.5 thinks adaptively when a request omits `thinking`,
 * and thinking tokens count toward the call's small output cap, so a rewrite
 * could stop at `max_tokens` after a thinking block with no text in it — an
 * `unusable` fallback on every such ask, with nothing in the log to say why.
 * A rewrite has no judgement in it to think about.
 *
 * Sent as an explicit `disabled`, which the provider forwards rather than
 * omits, and which Haiku 5.5 accepts at effort low/medium/high (no effort is
 * sent, so the default applies). It is also valid on Haiku 4.5, so pointing
 * `CONDENSE_MODEL`/`EXPAND_MODEL` back at the old model for a comparison arm
 * needs no other change.
 */
export const REWRITE_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "disabled" } },
} satisfies { anthropic: AnthropicLanguageModelOptions };

export function getCondenseModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.CONDENSE_MODEL || DEFAULT_CONDENSE_MODEL);
}

export function getExpandModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.EXPAND_MODEL || DEFAULT_CONDENSE_MODEL);
}
