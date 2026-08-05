/**
 * Answer model selection (SPEC §5): Claude Sonnet by default, overridable via
 * ANSWER_MODEL so the Week 3 Haiku 4.5 cost/quality comparison is an env
 * change, not a code change. Lives in its own module so route tests can swap
 * in a mock language model.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export const DEFAULT_ANSWER_MODEL = "claude-sonnet-5";

export function getAnswerModel(): LanguageModel {
  const anthropic = createAnthropic();
  return anthropic(process.env.ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL);
}
