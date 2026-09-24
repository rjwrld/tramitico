/**
 * Unit tests for the groundedness judge (SPEC §9, issues #26/#58): verdict
 * parsing, the majority rule, judge prompt assembly, and judgeAnswer's
 * re-judge/majority orchestration via an injected judgeOnce. The
 * model-calling eval lives in groundedness.eval.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import type { ResolvedDerivedFigure } from "../answer/derived";
import {
  blockingGroundednessFailures,
  buildJudgePrompt,
  GROUNDEDNESS_GATE,
  judgeAnswer,
  JUDGE_SYSTEM_PROMPT,
  majorityVerdict,
  parseJudgeVerdict,
  type JudgeVerdict,
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
  it("gates at 90% per SPEC §9", () => {
    expect(GROUNDEDNESS_GATE).toBeGreaterThanOrEqual(0.9);
  });

  it("instructs the judge to answer with the JSON verdict shape", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('"verdict"');
    expect(JUDGE_SYSTEM_PROMPT).toContain('"pass"');
    expect(JUDGE_SYSTEM_PROMPT).toContain('"fail"');
  });
});

describe("blockingGroundednessFailures (#324)", () => {
  const judged = (
    id: string,
    blocking: boolean,
    verdict: "pass" | "fail",
    reason = "",
  ) => ({ evalCase: { id, blocking }, verdict, reason });

  it("names a blocking case that failed, with the judge's reason", () => {
    expect(
      blockingGroundednessFailures([
        judged("ho-hacienda-solo-cliente-eeuu", true, "pass"),
        judged(
          "ho-minimo-caja-independiente-2026",
          true,
          "fail",
          "states 11,66 % as category 1's IVM rate; [6] says 9,91 %",
        ),
        judged("ho-t2-tipo-de-cambio", false, "fail", "invented discrepancy"),
      ]),
    ).toEqual([
      "ho-minimo-caja-independiente-2026 (states 11,66 % as category 1's IVM rate; [6] says 9,91 %)",
    ]);
  });

  it("names every blocking failure, in result order", () => {
    expect(
      blockingGroundednessFailures([
        judged("b", true, "fail", "second"),
        judged("a", true, "fail", "first"),
      ]),
    ).toEqual(["b (second)", "a (first)"]);
  });

  it("is empty when only non-blocking cases failed", () => {
    expect(
      blockingGroundednessFailures([
        judged("t1", true, "pass"),
        judged("t2-a", false, "fail", "unsupported claim"),
        judged("t2-b", false, "fail", "unsupported claim"),
      ]),
    ).toEqual([]);
  });

  it("is empty on no results", () => {
    expect(blockingGroundednessFailures([])).toEqual([]);
  });
});
