/**
 * Unit tests for the pure parts of the groundedness judge (SPEC §9, issue
 * #26): verdict parsing, the majority rule for re-judged failures, and the
 * judge prompt assembly. The model-calling side lives in
 * groundedness.integration.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  buildJudgePrompt,
  GROUNDEDNESS_GATE,
  JUDGE_SYSTEM_PROMPT,
  majorityVerdict,
  parseJudgeVerdict,
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
  score: 0.9,
  ...over,
});

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
