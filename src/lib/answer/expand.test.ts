/**
 * The expansion contract (issue #286): what the rewrite is allowed to cost,
 * what it is allowed to contain, and what happens when it does not work.
 *
 * The properties expand.ts is built around, one describe each: the rewrite
 * reaches retrieval as text, the call is bounded, and every failure path
 * yields `null` — "search the question alone" — rather than throwing. Nothing
 * here talks to a provider; `getExpandModel` is the seam, stubbed the way
 * condense.test.ts stubs it.
 */
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./model")>()),
  getExpandModel: vi.fn(),
}));

import manifest from "../../../corpus/manifest.json";
import {
  buildExpandPrompt,
  CORPUS_INVENTORY,
  cleanExpansion,
  expandQuery,
  expansionEnabled,
  EXPAND_MAX_OUTPUT_TOKENS,
  EXPAND_SYSTEM_PROMPT,
  MAX_EXPANSION_LENGTH,
} from "./expand";
import { getExpandModel } from "./model";
import { KNOB_ERROR_PREFIX } from "../knobs";

const QUESTION = "Me inscribí un año tarde, ¿qué me pasa?";
const EXPANSION =
  "Me inscribí un año tarde, ¿qué me pasa? Sanción por omisión de la " +
  "declaración de inscripción presentada fuera del plazo.";

function mockExpander(
  text: string,
  finish: { unified: "stop" | "length" | "content-filter"; raw: string } = {
    unified: "stop",
    raw: "end_turn",
  },
): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: text === "" ? [] : [{ type: "text" as const, text }],
      finishReason: finish,
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  vi.mocked(getExpandModel).mockReturnValue(model);
  return model;
}

function failingExpander(error: unknown): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
  vi.mocked(getExpandModel).mockReturnValue(model);
  return model;
}

/** The `reason=` of every expansion-failure line logged so far. */
function failureReasons(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map(([line]) => String(line))
    .filter((line) => line.startsWith("ask: expansion failed"))
    .map((line) => /reason=(\S+)/.exec(line)?.[1] ?? "");
}

beforeEach(() => {
  // `expansionEnabled` needs a provider, and the unit lane has none: without
  // this every case below would take the switched-off path and assert
  // nothing (#129's failure mode in miniature).
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(getExpandModel).mockReset();
});

describe("the rewrite", () => {
  it("returns the model's text and asks with the question", async () => {
    const model = mockExpander(EXPANSION);

    expect(await expandQuery(QUESTION)).toBe(EXPANSION);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(QUESTION);
    expect(failureReasons()).toEqual([]);
  });

  it("sends no temperature, turns thinking off, and caps the output", async () => {
    const model = mockExpander(EXPANSION);

    await expandQuery(QUESTION);

    // Same two Haiku 5.5 rules as condensation: a temperature is a 400 this
    // module would swallow, and default thinking would spend the cap.
    const call = model.doGenerateCalls[0];
    expect(call.temperature).toBeUndefined();
    expect(call.topP).toBeUndefined();
    expect(call.topK).toBeUndefined();
    expect(call.providerOptions).toEqual({
      anthropic: { thinking: { type: "disabled" } },
    });
    expect(call.maxOutputTokens).toBe(EXPAND_MAX_OUTPUT_TOKENS);
  });

  it("makes no call when expansion is switched off", async () => {
    const model = mockExpander(EXPANSION);
    vi.stubEnv("EXPAND", "off");

    expect(await expandQuery(QUESTION)).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    // Switched off is not failed: `EXPAND=off` is a measurement, not an
    // incident, so it counts nothing and logs nothing.
    expect(failureReasons()).toEqual([]);
  });

  it("still expands under an unknown EXPAND value, and logs it as an error (#499)", async () => {
    const model = mockExpander(EXPANSION);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EXPAND", "disabled");

    expect(expansionEnabled()).toBe(true);
    expect(await expandQuery(QUESTION)).toBe(EXPANSION);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(`${KNOB_ERROR_PREFIX} EXPAND="disabled"`),
    );
  });

  it("makes no call with no provider configured", async () => {
    const model = mockExpander(EXPANSION);
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await expandQuery(QUESTION)).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(failureReasons()).toEqual([]);
  });

  it("makes no call on an empty question", async () => {
    const model = mockExpander(EXPANSION);

    expect(await expandQuery("   ")).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    // Nothing went wrong, so nothing is counted.
    expect(failureReasons()).toEqual([]);
  });

  it("forbids the invented figure that would steer the search", () => {
    // Rule 4 is what keeps a probe from becoming an ungrounded answer: the
    // rewrite names the asunto, it does not supply cifras, plazos or
    // artículo numbers it would have to make up.
    expect(EXPAND_SYSTEM_PROMPT).toContain("No invente cifras");
    expect(buildExpandPrompt(QUESTION)).toContain(QUESTION);
  });

  it("asks for the rule in force when the figure asked for is future (#509)", () => {
    // Rule 7: asked for 2027's IVA rate, the expansion wrote «no incluyen
    // proyecciones…», a refusal no document contains, and the search for
    // ley-iva art. 10 went with it. A refusal is never a probe.
    expect(EXPAND_SYSTEM_PROMPT).toContain("redacte la norma vigente");
    expect(EXPAND_SYSTEM_PROMPT).toContain("que no hay proyecciones");
  });

  it("translates casual wording into the situation a norm regulates (#509)", () => {
    // Rules 8 and 9: Haiku 5.5 read colloquial questions word by word
    // («retroactivo» as arrears interest) and wrote a heading over a list
    // of neighbouring topics, where Haiku 4.5 wrote the rule (#502).
    expect(EXPAND_SYSTEM_PROMPT).toContain("tradúzcala a la situación");
    expect(EXPAND_SYSTEM_PROMPT).toContain("lista de asuntos vecinos");
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
    expect(failureReasons()).toEqual(["error"]);
  });

  it("returns null and counts a timeout when the budget expires", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    failingExpander(timeout);

    expect(await expandQuery(QUESTION, { timeoutMs: 5 })).toBeNull();
    expect(failureReasons()).toEqual(["timeout"]);
  });

  it("returns null and counts unusable output", async () => {
    mockExpander("   ");
    expect(await expandQuery(QUESTION)).toBeNull();

    mockExpander("x".repeat(MAX_EXPANSION_LENGTH + 1));
    expect(await expandQuery(QUESTION)).toBeNull();

    expect(failureReasons()).toEqual(["unusable", "unusable"]);
  });

  it("returns null when the cap is hit before any text", async () => {
    mockExpander("", { unified: "length", raw: "max_tokens" });

    expect(await expandQuery(QUESTION)).toBeNull();
    expect(failureReasons()).toEqual(["unusable"]);
  });

  it("returns null on a safety refusal, even with text before it", async () => {
    mockExpander(EXPANSION, { unified: "content-filter", raw: "refusal" });

    expect(await expandQuery(QUESTION)).toBeNull();
    expect(failureReasons()).toEqual(["unusable"]);
  });

  it("logs on a stable prefix and never logs the question", async () => {
    failingExpander(new Error("la pregunta secreta"));
    await expandQuery(QUESTION);

    const line = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(line).toContain("ask: expansion failed — reason=error");
    expect(line).not.toContain(QUESTION);
    expect(line).not.toContain("la pregunta secreta");
  });
});
