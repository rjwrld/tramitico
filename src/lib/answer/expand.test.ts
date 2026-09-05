/**
 * The expansion contract (issue #286): what the rewrite is allowed to cost,
 * what it is allowed to contain, and what happens when it does not work.
 *
 * The properties expand.ts is built around, one describe each: the rewrite
 * reaches retrieval as text, the call is bounded, and every failure path
 * yields `null` — "search the question alone" — rather than throwing. Nothing
 * here talks to a provider; `getCondenseModel` is the seam, stubbed the way
 * condense.test.ts stubs it.
 */
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./model", () => ({ getCondenseModel: vi.fn() }));

import manifest from "../../../corpus/manifest.json";
import {
  buildExpandPrompt,
  CORPUS_INVENTORY,
  cleanExpansion,
  expandFailureReason,
  expandFailures,
  expandQuery,
  EXPAND_SYSTEM_PROMPT,
  MAX_EXPANSION_LENGTH,
  resetExpandFailures,
} from "./expand";
import { getCondenseModel } from "./model";

const QUESTION = "Me inscribí un año tarde, ¿qué me pasa?";
const EXPANSION =
  "Me inscribí un año tarde, ¿qué me pasa? Sanción por omisión de la " +
  "declaración de inscripción presentada fuera del plazo.";

function mockExpander(text: string): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "end_turn" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  vi.mocked(getCondenseModel).mockReturnValue(model);
  return model;
}

function failingExpander(error: unknown): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
  vi.mocked(getCondenseModel).mockReturnValue(model);
  return model;
}

beforeEach(() => {
  resetExpandFailures();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getCondenseModel).mockReset();
  resetExpandFailures();
});

describe("the rewrite", () => {
  it("returns the model's text and asks with the question", async () => {
    const model = mockExpander(EXPANSION);

    expect(await expandQuery(QUESTION)).toBe(EXPANSION);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(QUESTION);
    expect(expandFailures()).toEqual({ timeout: 0, error: 0, unusable: 0 });
  });

  it("makes no call on an empty question", async () => {
    const model = mockExpander(EXPANSION);

    expect(await expandQuery("   ")).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    // Nothing went wrong, so nothing is counted.
    expect(expandFailures()).toEqual({ timeout: 0, error: 0, unusable: 0 });
  });

  it("forbids the invented figure that would steer the search", () => {
    // Rule 4 is what keeps a probe from becoming an ungrounded answer: the
    // rewrite names the asunto, it does not supply cifras, plazos or
    // artículo numbers it would have to make up.
    expect(EXPAND_SYSTEM_PROMPT).toContain("No invente cifras");
    expect(buildExpandPrompt(QUESTION)).toContain(QUESTION);
  });

  it("shows the model the corpus it is actually searching", () => {
    // The grounding, and the reason the rewrite names «Código de Normas y
    // Procedimientos Tributarios» rather than inventing a plausible term:
    // every ingested document's title is in the prompt, read off the
    // manifest, so a corpus change moves this prompt with it.
    for (const doc of manifest.documents) {
      expect(CORPUS_INVENTORY).toContain(doc.title);
    }
    expect(EXPAND_SYSTEM_PROMPT).toContain(CORPUS_INVENTORY);
  });
});

describe("cleaning what a model puts around one line", () => {
  it("drops quotes, extra lines and runs of whitespace", () => {
    expect(cleanExpansion("  «La pregunta oficial»  \n\nY otra cosa")).toBe(
      "La pregunta oficial",
    );
    expect(cleanExpansion("a   b\tc")).toBe("a b c");
    expect(cleanExpansion("")).toBe("");
  });
});

describe("every failure searches the question alone", () => {
  it("returns null and counts an error when the provider rejects", async () => {
    failingExpander(new Error("503"));

    expect(await expandQuery(QUESTION)).toBeNull();
    expect(expandFailures()).toEqual({ timeout: 0, error: 1, unusable: 0 });
  });

  it("returns null and counts a timeout when the budget expires", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    failingExpander(timeout);

    expect(await expandQuery(QUESTION, { timeoutMs: 5 })).toBeNull();
    expect(expandFailures()).toEqual({ timeout: 1, error: 0, unusable: 0 });
  });

  it("returns null and counts unusable output", async () => {
    mockExpander("   ");
    expect(await expandQuery(QUESTION)).toBeNull();

    mockExpander("x".repeat(MAX_EXPANSION_LENGTH + 1));
    expect(await expandQuery(QUESTION)).toBeNull();

    expect(expandFailures()).toEqual({ timeout: 0, error: 0, unusable: 2 });
  });

  it("logs on a stable prefix and never logs the question", async () => {
    failingExpander(new Error("la pregunta secreta"));
    await expandQuery(QUESTION);

    const line = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(line).toContain("ask: expansion failed — reason=error");
    expect(line).not.toContain(QUESTION);
    expect(line).not.toContain("la pregunta secreta");
  });

  it("reads an abort as the budget, like condensation does", () => {
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    const abort = new Error("x");
    abort.name = "AbortError";

    expect(expandFailureReason(timeout)).toBe("timeout");
    expect(expandFailureReason(abort)).toBe("timeout");
    expect(expandFailureReason(new Error("boom"))).toBe("error");
  });
});
