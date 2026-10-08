/**
 * Unit tests for the groundedness judge (SPEC §9, issues #26/#58): verdict
 * parsing, the majority rule, judge prompt assembly, and judgeAnswer's
 * re-judge/majority orchestration via an injected judgeOnce. The
 * model-calling eval lives in groundedness.eval.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import type { ResolvedDerivedFigure } from "../answer/derived";
import {
  DATASET_PATH,
  isRobustness,
  parseDataset,
  retrievalCases,
} from "./dataset";
import {
  BLOCKING_REASK_COUNT,
  blockingCaseVerdict,
  blockingGroundednessFailures,
  buildFailureLabelPrompt,
  buildJudgePrompt,
  FAILURE_LABEL_SYSTEM_PROMPT,
  GROUNDEDNESS_BASELINE,
  GROUNDEDNESS_CASES,
  GROUNDEDNESS_FLOOR,
  judgeAnswer,
  JUDGE_SYSTEM_PROMPT,
  labelFailure,
  majorityVerdict,
  needsReask,
  parseFailureLabel,
  parseJudgeVerdict,
  scoreAnswer,
  type AnswerToScore,
  type JudgeVerdict,
  type ScoredAnswer,
} from "./groundedness";

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: "c1",
  docKey: "ley-iva",
  docTitle: "Ley del IVA",
  norma: "Ley 6826",
  articulo: "Artículo 8",
  path: ["CAPÍTULO I"],
  part: 0,
  content: "Los servicios exportados no están sujetos al impuesto.",
  source: { url: "https://example.test/ley-iva" },
  fetchedAt: "2026-08-06T15:04:05Z",
  score: 0.9,
  vectorRank: 1,
  lexicalRank: null,
  ...over,
});

const derivedFigure: ResolvedDerivedFigure = {
  id: "bmc-ivm-2026",
  label: "Base mínima contributiva de IVM 2026",
  formula: "factor * salary",
  decimals: 0,
  inputs: [],
  value: 324_590,
  formattedValue: "¢324.590",
  formattedFormula: "0,87 × ¢373.092,30",
  citationMarkers: [1, 2],
};

describe("parseJudgeVerdict", () => {
  it("parses a bare JSON verdict", () => {
    expect(
      parseJudgeVerdict('{"verdict": "pass", "reason": "all claims cited"}'),
    ).toEqual({ verdict: "pass", reason: "all claims cited" });
  });

  it("parses a verdict wrapped in a fenced code block", () => {
    const text =
      '```json\n{"verdict": "fail", "reason": "invented a plazo"}\n```';
    expect(parseJudgeVerdict(text)).toEqual({
      verdict: "fail",
      reason: "invented a plazo",
    });
  });

  it("parses a verdict surrounded by prose", () => {
    const text = 'Mi análisis:\n{"verdict": "pass", "reason": "ok"}\nGracias.';
    expect(parseJudgeVerdict(text).verdict).toBe("pass");
  });

  it("reads the first object when the judge writes more after it (#311)", () => {
    // The shape that aborted #311's pin1 arm: a complete verdict, then
    // prose carrying braces of its own. Greedy first-{-to-last-} spans both.
    const text =
      '{\n  "verdict": "fail",\n  "reason": "fragment [2} is misquoted"\n}\n\n' +
      'Nota: {"verdict": "pass"} sería incorrecto aquí.';
    expect(parseJudgeVerdict(text)).toEqual({
      verdict: "fail",
      reason: "fragment [2} is misquoted",
    });
  });

  it("rejects an object that never closes", () => {
    expect(() => parseJudgeVerdict('{"verdict": "pass", "reason": "')).toThrow(
      /no JSON object/,
    );
  });

  it("rejects text without a JSON object", () => {
    expect(() => parseJudgeVerdict("the answer looks fine")).toThrow(
      /no JSON object/,
    );
  });

  it("rejects a JSON object with an unknown verdict value", () => {
    expect(() =>
      parseJudgeVerdict('{"verdict": "maybe", "reason": "?"}'),
    ).toThrow(/verdict/);
  });

  it("defaults a missing reason to an empty string", () => {
    expect(parseJudgeVerdict('{"verdict": "fail"}')).toEqual({
      verdict: "fail",
      reason: "",
    });
  });
});

describe("majorityVerdict", () => {
  it("returns the single verdict for a one-element list", () => {
    expect(majorityVerdict(["pass"])).toBe("pass");
    expect(majorityVerdict(["fail"])).toBe("fail");
  });

  it("returns the majority of three verdicts", () => {
    expect(majorityVerdict(["fail", "pass", "pass"])).toBe("pass");
    expect(majorityVerdict(["fail", "fail", "pass"])).toBe("fail");
    expect(majorityVerdict(["fail", "fail", "fail"])).toBe("fail");
  });

  it("rejects an empty list", () => {
    expect(() => majorityVerdict([])).toThrow(/empty/);
  });
});

describe("buildJudgePrompt", () => {
  it("includes the question, the numbered fragments, and the answer", () => {
    const prompt = buildJudgePrompt(
      "¿Debo cobrar IVA a clientes en el extranjero?",
      [chunk()],
      "No, la exportación de servicios no está sujeta [1].",
    );
    expect(prompt).toContain("¿Debo cobrar IVA a clientes en el extranjero?");
    expect(prompt).toContain("[1] Ley del IVA — Artículo 8 (Ley 6826)");
    expect(prompt).toContain("Los servicios exportados");
    expect(prompt).toContain("No, la exportación de servicios no está sujeta");
  });

  it("includes the system-calculated evidence the answer model saw", () => {
    const prompt = buildJudgePrompt(
      "¿Cuánto pago?",
      [chunk(), chunk()],
      "La base es ¢324.590 [1][2].",
      [derivedFigure],
    );

    expect(prompt).toContain("Cifras derivadas");
    expect(prompt).toContain("¢324.590");
    expect(prompt).toContain("[1][2]");
  });
});

describe("judgeAnswer", () => {
  /** Scripted judge: returns the given verdicts in order, counts its calls. */
  const scripted = (...script: JudgeVerdict[]) => {
    let calls = 0;
    const judgeOnce = () => {
      if (calls >= script.length) {
        throw new Error("judgeAnswer called judgeOnce more than scripted");
      }
      return Promise.resolve(script[calls++]);
    };
    return { judgeOnce, calls: () => calls };
  };
  const pass = (reason = "ok"): JudgeVerdict => ({ verdict: "pass", reason });
  const fail = (reason: string): JudgeVerdict => ({ verdict: "fail", reason });
  const judge = (
    judgeOnce: () => Promise<JudgeVerdict>,
  ): ReturnType<typeof judgeAnswer> =>
    judgeAnswer("¿pregunta?", [chunk()], "respuesta", judgeOnce);

  it("passes on a first-call pass without re-judging", async () => {
    const s = scripted(pass());
    await expect(judge(s.judgeOnce)).resolves.toEqual({
      verdict: "pass",
      verdicts: ["pass"],
      reason: "ok",
    });
    expect(s.calls()).toBe(1);
  });

  it("re-judges a first fail twice and lets the majority overturn it", async () => {
    const s = scripted(fail("invento"), pass(), pass());
    await expect(judge(s.judgeOnce)).resolves.toMatchObject({
      verdict: "pass",
      verdicts: ["fail", "pass", "pass"],
    });
    expect(s.calls()).toBe(3);
  });

  it("fails on majority fail with the last failing reason", async () => {
    const s = scripted(fail("primer motivo"), fail("segundo motivo"), pass());
    await expect(judge(s.judgeOnce)).resolves.toEqual({
      verdict: "fail",
      verdicts: ["fail", "fail", "pass"],
      reason: "segundo motivo",
    });
  });

  it("keeps the last failing reason even when a pass comes after it", async () => {
    const s = scripted(fail("primer motivo"), pass(), fail("último motivo"));
    await expect(judge(s.judgeOnce)).resolves.toEqual({
      verdict: "fail",
      verdicts: ["fail", "pass", "fail"],
      reason: "último motivo",
    });
  });

  it("fails on a unanimous fail", async () => {
    const s = scripted(fail("a"), fail("b"), fail("c"));
    await expect(judge(s.judgeOnce)).resolves.toEqual({
      verdict: "fail",
      verdicts: ["fail", "fail", "fail"],
      reason: "c",
    });
  });

  it("propagates a judge error instead of swallowing it", async () => {
    const judgeOnce = () => Promise.reject(new Error("judge exploded"));
    await expect(judge(judgeOnce)).rejects.toThrow(/judge exploded/);
  });
});

describe("judge configuration", () => {
  it("instructs the judge to answer with the JSON verdict shape", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('"verdict"');
    expect(JUDGE_SYSTEM_PROMPT).toContain('"pass"');
    expect(JUDGE_SYSTEM_PROMPT).toContain('"fail"');
  });
});

describe("the tracked groundedness baseline (#474)", () => {
  it("is 73 grounded answers over 74 cases, failing a lane at 68 or below", () => {
    // #512's two final lanes both read 73 of 74; the baseline is the lower
    // of the two (2026-10-08).
    expect(GROUNDEDNESS_BASELINE).toBe(73);
    expect(GROUNDEDNESS_CASES).toBe(74);
    expect(GROUNDEDNESS_FLOOR).toBe(69);
  });

  it("counts the population the lane gates: no case added without a re-set", () => {
    // The lane's `gated` set: every non-abstention case outside the
    // robustness block. A count baseline over a different population reads
    // as a regression or a gain that is neither.
    const gated = retrievalCases(
      parseDataset(readFileSync(DATASET_PATH, "utf8")),
    ).filter((evalCase) => !isRobustness(evalCase));
    expect(gated).toHaveLength(GROUNDEDNESS_CASES);
  });
});

const answer = (
  verdict: "pass" | "fail",
  reason = "",
  falseAbsence = false,
): ScoredAnswer => ({ verdict, reason, falseAbsence });

describe("blockingCaseVerdict (#474)", () => {
  it("reads a failing case on three answers", () => {
    expect(BLOCKING_REASK_COUNT).toBe(2);
  });

  it("passes a case whose first answer passed, on that answer alone", () => {
    expect(blockingCaseVerdict([answer("pass")])).toBe("pass");
  });

  it("fails a case on two failing answers of three", () => {
    expect(
      blockingCaseVerdict([answer("fail"), answer("fail"), answer("pass")]),
    ).toBe("fail");
    expect(
      blockingCaseVerdict([answer("fail"), answer("pass"), answer("fail")]),
    ).toBe("fail");
    expect(
      blockingCaseVerdict([answer("fail"), answer("fail"), answer("fail")]),
    ).toBe("fail");
  });

  it("passes a case whose first answer alone failed", () => {
    expect(
      blockingCaseVerdict([answer("fail"), answer("pass"), answer("pass")]),
    ).toBe("pass");
  });

  it("fails on a false absence claim in any answer, whatever the others read", () => {
    // #500's hard zero wins over the 2-of-3 reading.
    expect(blockingCaseVerdict([answer("fail", "", true)])).toBe("fail");
    expect(
      blockingCaseVerdict([
        answer("fail"),
        answer("pass"),
        answer("fail", "", true),
      ]),
    ).toBe("fail");
  });

  it("refuses to read a failing case without its re-asks", () => {
    expect(() => blockingCaseVerdict([answer("fail")])).toThrow(/3 answers/);
    expect(() => blockingCaseVerdict([answer("fail"), answer("pass")])).toThrow(
      /got 2/,
    );
  });
});

describe("scoreAnswer (#474, #521)", () => {
  const held = (over: Partial<AnswerToScore> = {}): AnswerToScore => ({
    verdict: "pass",
    reason: "ok",
    answer: "La base es ¢324.590 [1][2].",
    citations: { ok: true },
    derivedFigures: [derivedFigure],
    checks: null,
    ...over,
  });

  it("passes an answer the judges passed and the route would ship", () => {
    expect(scoreAnswer(held())).toEqual({
      verdict: "pass",
      reason: "ok",
      falseAbsence: false,
    });
  });

  it("keeps the judges' failure and its reason", () => {
    expect(
      scoreAnswer(held({ verdict: "fail", reason: "wrong rate" })),
    ).toMatchObject({ verdict: "fail", reason: "wrong rate" });
  });

  it("fails an answer the citation invariant would refuse (#168)", () => {
    expect(
      scoreAnswer(
        held({
          answer: "La base es ¢324.590.",
          citations: { ok: false, violation: "no_markers", unresolved: [] },
        }),
      ),
    ).toEqual({
      verdict: "fail",
      reason: "the route would refuse it (#168): no_markers",
      falseAbsence: false,
    });
  });

  it("fails a derived figure quoted without its inputs (#281)", () => {
    expect(scoreAnswer(held({ answer: "La base es ¢324.590 [1]." }))).toEqual({
      verdict: "fail",
      reason: "derived figures without their inputs (#281): bmc-ivm-2026",
      falseAbsence: false,
    });
  });

  it("passes the weak-retrieval decline, which carries no markers by design", () => {
    expect(
      scoreAnswer(
        held({
          answer: "No encuentro base oficial…",
          citations: null,
          derivedFigures: [],
        }),
      ).verdict,
    ).toBe("pass");
  });

  it("flags a false absence claim from #500's checks", () => {
    const checks = {
      absence: {
        falseClaims: [{ target: "Artículo 10" }],
        opening: null,
      },
      typos: [],
    } as unknown as NonNullable<AnswerToScore["checks"]>;
    expect(
      scoreAnswer(held({ verdict: "fail", reason: "absence", checks })),
    ).toMatchObject({ verdict: "fail", falseAbsence: true });
  });
});

describe("needsReask (#474)", () => {
  const read = (blocking: boolean, ...answers: ScoredAnswer[]) => ({
    evalCase: { id: "c", blocking },
    answers,
  });

  it("re-asks a blocking case whose first answer the judges failed", () => {
    expect(needsReask(read(true, answer("fail")))).toBe(true);
  });

  it("does not re-ask a pass, a non-blocking case, or one already re-asked", () => {
    expect(needsReask(read(true, answer("pass")))).toBe(false);
    expect(needsReask(read(false, answer("fail")))).toBe(false);
    expect(
      needsReask(read(true, answer("fail"), answer("fail"), answer("pass"))),
    ).toBe(false);
  });

  it("does not re-ask a false absence claim: it has decided the case", () => {
    expect(needsReask(read(true, answer("fail", "", true)))).toBe(false);
  });
});

describe("blockingGroundednessFailures (#324, #474)", () => {
  const judged = (
    id: string,
    blocking: boolean,
    ...answers: ScoredAnswer[]
  ) => ({ evalCase: { id, blocking }, answers });

  it("names a blocking case that failed two of three, with each failing reason", () => {
    expect(
      blockingGroundednessFailures([
        judged("ho-hacienda-solo-cliente-eeuu", true, answer("pass")),
        judged(
          "ho-minimo-caja-independiente-2026",
          true,
          answer("fail", "states 11,66 % as category 1's IVM rate"),
          answer("pass"),
          answer("fail", "cites [6] for 9,91 %, which [6] does not carry"),
        ),
        judged("ho-t2-tipo-de-cambio", false, answer("fail", "invented")),
      ]),
    ).toEqual([
      "ho-minimo-caja-independiente-2026 (2 of 3 answers: states 11,66 % as " +
        "category 1's IVM rate | cites [6] for 9,91 %, which [6] does not carry)",
    ]);
  });

  it("passes a blocking case that failed on its first answer only", () => {
    expect(
      blockingGroundednessFailures([
        judged(
          "multa",
          true,
          answer("fail", "x"),
          answer("pass"),
          answer("pass"),
        ),
      ]),
    ).toEqual([]);
  });

  it("names the answer that made a false absence claim", () => {
    expect(
      blockingGroundednessFailures([
        judged(
          "ho-abs",
          true,
          answer("fail", "strict call"),
          answer("pass"),
          answer(
            "fail",
            "false corpus-absence claim (#500): Artículo 10",
            true,
          ),
        ),
      ]),
    ).toEqual([
      "ho-abs (answer 3: false corpus-absence claim (#500): Artículo 10)",
    ]);
  });

  it("names every blocking failure, in result order", () => {
    expect(
      blockingGroundednessFailures([
        judged("b", true, answer("fail", "second", true)),
        judged("a", true, answer("fail", "first", true)),
      ]),
    ).toEqual(["b (answer 1: second)", "a (answer 1: first)"]);
  });

  it("is empty when only non-blocking cases failed", () => {
    expect(
      blockingGroundednessFailures([
        judged("t1", true, answer("pass")),
        judged("t2-a", false, answer("fail", "unsupported claim")),
      ]),
    ).toEqual([]);
  });

  it("is empty on no results", () => {
    expect(blockingGroundednessFailures([])).toEqual([]);
  });
});

describe("failure labels (#474, recorded, never gated)", () => {
  it("asks for one of the two labels in a JSON object", () => {
    expect(FAILURE_LABEL_SYSTEM_PROMPT).toContain('"contradiction"');
    expect(FAILURE_LABEL_SYSTEM_PROMPT).toContain('"inference"');
    expect(FAILURE_LABEL_SYSTEM_PROMPT).toContain('"label"');
  });

  it("shows the labeller the judge's material and the judges' reason", () => {
    const prompt = buildFailureLabelPrompt(
      "¿Cuánto pago?",
      [chunk()],
      "Pagás 11,66 % [1].",
      "[1] does not carry 11,66 %",
    );
    expect(prompt).toContain(
      buildJudgePrompt("¿Cuánto pago?", [chunk()], "Pagás 11,66 % [1]."),
    );
    expect(prompt).toMatch(/Motivo del juez:\n\[1\] does not carry 11,66 %$/);
  });

  it("parses a label and its reason", () => {
    expect(
      parseFailureLabel(
        '```json\n{"label": "inference", "reason": "restates [2]"}\n```',
      ),
    ).toEqual({ label: "inference", reason: "restates [2]" });
  });

  it("rejects an unknown label", () => {
    expect(() => parseFailureLabel('{"label": "minor"}')).toThrow(/label/);
  });

  it("returns the labeller's reading", async () => {
    await expect(
      labelFailure("q", [chunk()], "a", "why", [], () =>
        Promise.resolve('{"label": "contradiction", "reason": "wrong rate"}'),
      ),
    ).resolves.toEqual({ label: "contradiction", reason: "wrong rate" });
  });

  it("records a failed call as no label rather than throwing", async () => {
    await expect(
      labelFailure("q", [chunk()], "a", "why", [], () =>
        Promise.reject(new Error("overloaded")),
      ),
    ).resolves.toEqual({
      label: null,
      reason: "not labelled: Error: overloaded",
    });
    await expect(
      labelFailure("q", [chunk()], "a", "why", [], () =>
        Promise.resolve("no idea"),
      ),
    ).resolves.toMatchObject({ label: null });
  });
});
