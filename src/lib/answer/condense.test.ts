/**
 * The condensation contract (issue #132): when it runs, what it is allowed to
 * cost, and what happens when it does not work.
 *
 * The three properties condense.ts is built around, one describe each:
 * a first turn makes no call at all, the window and the prompt are bounded,
 * and every failure path hands the raw question back rather than throwing.
 * Nothing here talks to a provider — `getCondenseModel` is the seam, stubbed
 * exactly the way route tests stub `getAnswerModel`.
 */
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./model", () => ({ getCondenseModel: vi.fn() }));

import {
  buildCondensePrompt,
  cleanCondensed,
  condenseFailureReason,
  condenseFailures,
  condenseQuestion,
  CONDENSE_SYSTEM_PROMPT,
  resetCondenseFailures,
} from "./condense";
import {
  MAX_HISTORY_TURNS,
  MAX_TURN_ANSWER_CHARS,
  type ConversationTurn,
} from "./contract";
import { getCondenseModel } from "./model";

const FOLLOW_UP = "¿y si también soy asalariado?";
const STANDALONE =
  "¿Cómo cotizo a la CCSS si trabajo por cuenta propia y además soy asalariado?";

function turn(
  n: number,
  over: Partial<ConversationTurn> = {},
): ConversationTurn {
  return {
    question: `¿Pregunta ${n} sobre la CCSS?`,
    answer: `Respuesta ${n} sobre la CCSS.`,
    ...over,
  };
}

/** A condenser that answers with `text`, and records what it was asked. */
function mockCondenser(text: string): MockLanguageModelV4 {
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

/** A condenser that rejects with `error` — an outage, or the timeout. */
function failingCondenser(error: unknown): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
  vi.mocked(getCondenseModel).mockReturnValue(model);
  return model;
}

/** The prompt text the provider was actually called with. */
function promptText(model: MockLanguageModelV4): string {
  const call = model.doGenerateCalls[0];
  return JSON.stringify(call.prompt);
}

beforeEach(() => {
  resetCondenseFailures();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getCondenseModel).mockReset();
  resetCondenseFailures();
});

describe("first turns skip condensation entirely (#132 req. 2)", () => {
  it("makes no model call when there is no history", async () => {
    const model = mockCondenser(STANDALONE);

    const result = await condenseQuestion("¿Cuánto es el IVA?");

    expect(result).toEqual({ query: "¿Cuánto es el IVA?", condensed: null });
    expect(model.doGenerateCalls).toHaveLength(0);
    // Not a failure either: nothing went wrong, so nothing is counted.
    expect(condenseFailures()).toEqual({ timeout: 0, error: 0, unusable: 0 });
  });

  it("makes no model call when every turn in the window is unusable", async () => {
    const model = mockCondenser(STANDALONE);

    // A half-turn is not a turn: there is no antecedent to resolve against.
    const result = await condenseQuestion(FOLLOW_UP, [
      { question: "¿Y esto?", answer: "" },
      { question: 7, answer: "algo" },
      null,
    ]);

    expect(result).toEqual({ query: FOLLOW_UP, condensed: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("the standalone rewrite", () => {
  it("feeds the pipeline the rewrite and reports it separately", async () => {
    mockCondenser(STANDALONE);

    const result = await condenseQuestion(FOLLOW_UP, [turn(1)]);

    expect(result).toEqual({ query: STANDALONE, condensed: STANDALONE });
  });

  it("sends the system prompt, the turns and the follow-up", async () => {
    const model = mockCondenser(STANDALONE);

    await condenseQuestion(FOLLOW_UP, [turn(1)]);

    const call = model.doGenerateCalls[0];
    expect(call.prompt[0]).toEqual({
      role: "system",
      content: CONDENSE_SYSTEM_PROMPT,
    });
    expect(promptText(model)).toContain(turn(1).question);
    expect(promptText(model)).toContain(FOLLOW_UP);
    // Deterministic and capped: a rewrite is not a place for sampling, and a
    // model that has started explaining itself is stopped rather than paid for.
    expect(call.temperature).toBe(0);
    expect(call.maxOutputTokens).toBeGreaterThan(0);
  });

  it("strips the quoting a model puts around a one-line answer", () => {
    expect(cleanCondensed(`  "${STANDALONE}"\n\nEspero que ayude.`)).toBe(
      STANDALONE,
    );
    expect(cleanCondensed("«¿Cuánto es\n el IVA?»")).toBe("¿Cuánto es");
  });
});

describe("the window and the prompt are bounded (#132 req. 4)", () => {
  it(`carries at most the last ${MAX_HISTORY_TURNS} exchanges`, async () => {
    const model = mockCondenser(STANDALONE);
    const turns = [1, 2, 3, 4, 5].map((n) => turn(n));

    await condenseQuestion(FOLLOW_UP, turns);

    const prompt = promptText(model);
    expect(prompt).not.toContain(turn(1).question);
    expect(prompt).not.toContain(turn(2).question);
    for (const n of [3, 4, 5]) expect(prompt).toContain(turn(n).question);
  });

  it("truncates a long prior answer rather than paying for all of it", async () => {
    const model = mockCondenser(STANDALONE);
    const answer = `${"dato ".repeat(1_000)}final`;

    await condenseQuestion(FOLLOW_UP, [turn(1, { answer })]);

    const prompt = promptText(model);
    expect(prompt).not.toContain("final");
    expect(prompt.length).toBeLessThan(
      MAX_TURN_ANSWER_CHARS * MAX_HISTORY_TURNS + 8_000,
    );
  });

  it("keeps the cost of the tenth follow-up equal to the second's", async () => {
    const model = mockCondenser(STANDALONE);

    await condenseQuestion(FOLLOW_UP, [turn(1), turn(2)]);
    const short = promptText(model).length;

    vi.mocked(getCondenseModel).mockReset();
    const longer = mockCondenser(STANDALONE);
    await condenseQuestion(
      FOLLOW_UP,
      Array.from({ length: 20 }, (_, i) => turn(i + 1)),
    );

    // Three turns instead of two, and never more, however long the thread got.
    expect(promptText(longer).length).toBeLessThan(short * 2);
  });
});

describe("failure always falls back to the raw question (#132 req. 4)", () => {
  it("falls back when the provider errors, and counts it", async () => {
    failingCondenser(new Error("provider exploded"));

    const result = await condenseQuestion(FOLLOW_UP, [turn(1)]);

    expect(result).toEqual({ query: FOLLOW_UP, condensed: null });
    expect(condenseFailures()).toEqual({ timeout: 0, error: 1, unusable: 0 });
  });

  it("falls back when the budget expires, counted as a timeout", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    failingCondenser(timeout);

    const result = await condenseQuestion(FOLLOW_UP, [turn(1)], {
      timeoutMs: 5,
    });

    expect(result).toEqual({ query: FOLLOW_UP, condensed: null });
    expect(condenseFailures()).toEqual({ timeout: 1, error: 0, unusable: 0 });
  });

  it("times out a condenser that never answers", async () => {
    vi.mocked(getCondenseModel).mockReturnValue(
      new MockLanguageModelV4({
        doGenerate: async ({ abortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal?.addEventListener("abort", () =>
              reject(abortSignal.reason),
            );
          }),
      }),
    );

    const result = await condenseQuestion(FOLLOW_UP, [turn(1)], {
      timeoutMs: 20,
    });

    expect(result).toEqual({ query: FOLLOW_UP, condensed: null });
    expect(condenseFailures().timeout).toBe(1);
  });

  it("falls back on an empty or oversized rewrite", async () => {
    mockCondenser("   \n  ");
    await expect(condenseQuestion(FOLLOW_UP, [turn(1)])).resolves.toEqual({
      query: FOLLOW_UP,
      condensed: null,
    });

    vi.mocked(getCondenseModel).mockReset();
    mockCondenser("¿".repeat(2_000));
    await expect(condenseQuestion(FOLLOW_UP, [turn(1)])).resolves.toEqual({
      query: FOLLOW_UP,
      condensed: null,
    });

    expect(condenseFailures()).toEqual({ timeout: 0, error: 0, unusable: 2 });
  });

  it("logs on the stable prefix, with no question text in the line", async () => {
    const warn = vi.mocked(console.warn);
    failingCondenser(new Error(`fallo con ${FOLLOW_UP}`));

    await condenseQuestion(FOLLOW_UP, [turn(1)]);

    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain("ask: condensation failed — reason=error");
    // #136: prior turns are question text, and question text never reaches a
    // log — `describeError` is the only way an error appears here.
    expect(line).toContain("error=Error");
    expect(line).not.toContain(FOLLOW_UP);
    expect(line).not.toContain(turn(1).question);
  });

  it("classifies both shapes of abort as the budget expiring", () => {
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    const abort = new Error("x");
    abort.name = "AbortError";
    expect(condenseFailureReason(timeout)).toBe("timeout");
    expect(condenseFailureReason(abort)).toBe("timeout");
    expect(condenseFailureReason(new Error("503"))).toBe("error");
    expect(condenseFailureReason("not an error")).toBe("error");
  });
});

describe("buildCondensePrompt", () => {
  it("labels each exchange so the follow-up is unambiguous", () => {
    const prompt = buildCondensePrompt(FOLLOW_UP, [turn(1), turn(2)]);
    expect(prompt).toContain("Intercambio 1");
    expect(prompt).toContain("Intercambio 2");
    expect(prompt).toContain(`Pregunta nueva:\n${FOLLOW_UP}`);
    expect(prompt.trimEnd().endsWith("Pregunta autónoma:")).toBe(true);
  });
});
