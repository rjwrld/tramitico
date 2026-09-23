import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_EFFORTS,
  DEFAULT_ANSWER_MODEL,
  answerEffort,
  answerModelLabel,
  answerProviderOptions,
} from "./model";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("answer effort (#356)", () => {
  it("sends nothing when ANSWER_EFFORT is unset — the provider default", () => {
    vi.stubEnv("ANSWER_EFFORT", undefined);
    expect(answerEffort()).toBeNull();
    expect(answerProviderOptions()).toBeUndefined();
  });

  it("reads empty as unset, the way eval.yml interpolates an unset variable", () => {
    vi.stubEnv("ANSWER_EFFORT", "");
    expect(answerProviderOptions()).toBeUndefined();
  });

  it("ignores an unrecognised value rather than sending it to the provider", () => {
    vi.stubEnv("ANSWER_EFFORT", "Medium");
    expect(answerProviderOptions()).toBeUndefined();
  });

  it.each(ANSWER_EFFORTS)(
    "passes %s through as the Anthropic effort",
    (effort) => {
      vi.stubEnv("ANSWER_EFFORT", effort);
      expect(answerProviderOptions()).toEqual({ anthropic: { effort } });
    },
  );
});

describe("answerModelLabel", () => {
  it("is the default model alone when neither knob is set", () => {
    vi.stubEnv("ANSWER_MODEL", "");
    vi.stubEnv("ANSWER_EFFORT", "");
    expect(answerModelLabel()).toBe(DEFAULT_ANSWER_MODEL);
  });

  it("names the effort, so two arms differing only in effort never share a transcript name", () => {
    vi.stubEnv("ANSWER_MODEL", "claude-haiku-4-5");
    vi.stubEnv("ANSWER_EFFORT", "medium");
    expect(answerModelLabel()).toBe("claude-haiku-4-5-effort-medium");
  });
});
