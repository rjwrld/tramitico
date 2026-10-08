import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOB_ERROR_PREFIX } from "../knobs";
import { condenseQuestion, CONDENSE_MAX_OUTPUT_TOKENS } from "./condense";
import { expandQuery, EXPAND_MAX_OUTPUT_TOKENS } from "./expand";
import {
  ANSWER_EFFORTS,
  DEFAULT_ANSWER_MODEL,
  DEFAULT_CONDENSE_MODEL,
  answerEffort,
  answerModelLabel,
  answerProviderOptions,
} from "./model";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("ignores an unrecognised value rather than sending it to the provider, and logs it once (#519)", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ANSWER_MODEL", "");
    vi.stubEnv("ANSWER_EFFORT", "Medium");
    expect(answerEffort()).toBeNull();
    expect(answerProviderOptions()).toBeUndefined();
    expect(answerModelLabel()).toBe(DEFAULT_ANSWER_MODEL);
    expect(errors).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledWith(
      `${KNOB_ERROR_PREFIX} ANSWER_EFFORT="Medium"; accepted: low | medium | high | xhigh | max, or unset; reading it as unset`,
    );
  });

  it("reads unset, empty and every accepted effort without a word", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of [undefined, "", ...ANSWER_EFFORTS]) {
      vi.stubEnv("ANSWER_EFFORT", value);
      answerEffort();
    }
    expect(errors).not.toHaveBeenCalled();
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

/**
 * The two rewrite calls as Anthropic would receive them: the real provider,
 * with `fetch` stubbed, so no request leaves the process. The mock-model
 * cases in condense.test.ts and expand.test.ts check what the modules ask
 * for; this checks what `@ai-sdk/anthropic` turns that into for a model it
 * does not know yet, which is where a dropped `thinking` or a forwarded
 * `temperature` would hide — both calls swallow the resulting 400.
 */
describe("the rewrite calls on the wire (Haiku 5.5)", () => {
  type Body = Record<string, unknown>;

  /** Stubs `fetch` with one Messages API reply, and records each body sent. */
  function stubMessages(reply: { content: unknown[]; stop_reason: string }) {
    const bodies: Body[] = [];
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CONDENSE_MODEL", "");
    vi.stubEnv("EXPAND_MODEL", "");
    vi.stubEnv("EXPAND", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Body);
        return new Response(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: DEFAULT_CONDENSE_MODEL,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
            ...reply,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    return bodies;
  }

  /** The `reason=` of every rewrite-failure line, condensation's or expansion's. */
  function failureReasons(warn: { mock: { calls: unknown[][] } }): string[] {
    return warn.mock.calls.map(
      ([line]) => /failed — reason=(\S+)/.exec(String(line))?.[1] ?? "",
    );
  }

  const TURNS = [{ question: "¿Qué es el IVA?", answer: "Un impuesto." }];
  const ANSWERED = {
    content: [{ type: "text", text: "¿Cómo se declara el IVA?" }],
    stop_reason: "end_turn",
  };

  it("defaults both calls to Haiku 5.5", () => {
    expect(DEFAULT_CONDENSE_MODEL).toBe("claude-haiku-5-5");
  });

  it("sends condensation with thinking disabled and no sampling parameters", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = stubMessages(ANSWERED);

    const result = await condenseQuestion("¿y cómo lo declaro?", TURNS);

    expect(result.condensed).toBe("¿Cómo se declara el IVA?");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: CONDENSE_MAX_OUTPUT_TOKENS,
      thinking: { type: "disabled" },
    });
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(bodies[0]).not.toHaveProperty("top_p");
    expect(bodies[0]).not.toHaveProperty("top_k");
    // No provider warning either: nothing had to be dropped on the way out.
    expect(warn).not.toHaveBeenCalled();
  });

  it("sends expansion with thinking disabled and no sampling parameters", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = stubMessages(ANSWERED);

    expect(await expandQuery("¿Cuánto es el IVA?")).toBe(
      "¿Cómo se declara el IVA?",
    );
    expect(bodies[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: EXPAND_MAX_OUTPUT_TOKENS,
      thinking: { type: "disabled" },
    });
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back on a refusal, for both calls", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubMessages({
      content: [{ type: "text", text: "¿Cómo se declara" }],
      stop_reason: "refusal",
    });

    expect(await condenseQuestion("¿y cómo lo declaro?", TURNS)).toEqual({
      query: "¿y cómo lo declaro?",
      condensed: null,
    });
    expect(await expandQuery("¿Cuánto es el IVA?")).toBeNull();
    // A completed call read as unusable, not a request that failed.
    expect(failureReasons(warn)).toEqual(["unusable", "unusable"]);
  });

  it("falls back when thinking spent the cap and no text came back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubMessages({
      content: [{ type: "thinking", thinking: "", signature: "sig" }],
      stop_reason: "max_tokens",
    });

    expect(
      (await condenseQuestion("¿y cómo lo declaro?", TURNS)).condensed,
    ).toBeNull();
    expect(await expandQuery("¿Cuánto es el IVA?")).toBeNull();
    expect(failureReasons(warn)).toEqual(["unusable", "unusable"]);
  });
});
