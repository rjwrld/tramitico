import { describe, expect, it } from "vitest";
import {
  AMENDING_CHUNKS,
  AMENDING_JUDGE_SYSTEM_PROMPT,
  AMENDING_ONLY_IN_CONSOLIDATED,
  AMENDING_QUESTION,
  buildAmendingJudgePrompt,
} from "./amending-law";

describe("AMENDING_CHUNKS", () => {
  it("are the same artículo of the same norma at two moments", () => {
    expect(AMENDING_CHUNKS).toHaveLength(2);
    const [consolidated, reform] = AMENDING_CHUNKS;
    expect(consolidated.articulo).toBe(reform.articulo);
    // Same epígrafe — the signal rule 4a tells the model to look for.
    expect(consolidated.content).toContain("Artículo 11- Tarifa reducida.");
    expect(reform.content).toContain("Artículo 11- Tarifa reducida.");
  });

  it("differ on a figure, which is what used to trip rule 4", () => {
    const [consolidated, reform] = AMENDING_CHUNKS;
    expect(consolidated.content).toContain(AMENDING_ONLY_IN_CONSOLIDATED);
    expect(reform.content).not.toContain(AMENDING_ONLY_IN_CONSOLIDATED);
  });

  it("carry the two relation signals the prompt names", () => {
    const [consolidated, reform] = AMENDING_CHUNKS;
    // The title says the text is consolidated…
    expect(consolidated.docTitle).toMatch(/texto consolidado/i);
    // …and its inline notes say which later laws reformed it.
    expect(consolidated.content).toMatch(/Así reformado|Así adicionado/);
    // The reform carries no such notes: it is the text as enacted.
    expect(reform.content).not.toMatch(/Así reformado|Así adicionado/);
  });

  it("are distinct documents, so a discrepancy would get two [n] markers", () => {
    const [consolidated, reform] = AMENDING_CHUNKS;
    expect(consolidated.docKey).not.toBe(reform.docKey);
  });
});

describe("AMENDING_JUDGE_SYSTEM_PROMPT", () => {
  it("asks the inverse of the conflict judge: was a discrepancy invented?", () => {
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/invent a disagreement/i);
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/NOT two sources in conflict/);
    // The two failure shapes seen in #157's gate run: the stated discrepancy
    // and the verify-which-one-rules referral that follows it.
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/disagree, differ/i);
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/verify with Hacienda/i);
    // Naming a real reform the fragments state is not the failure.
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/IS allowed/);
    expect(AMENDING_JUDGE_SYSTEM_PROMPT).toMatch(/"verdict"/);
  });
});

describe("buildAmendingJudgePrompt", () => {
  it("hands the judge the question, both numbered fragments, and the answer", () => {
    const prompt = buildAmendingJudgePrompt(
      AMENDING_QUESTION,
      AMENDING_CHUNKS,
      "Las tarifas reducidas son 4%, 2%, 1% y 0,5% [1].",
    );
    expect(prompt).toContain(AMENDING_QUESTION);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain("Respuesta del asistente:");
    // The judge is told the relation by construction — it is not being asked
    // to discover it, only whether the answer respected it.
    expect(prompt).toMatch(/la misma norma en dos momentos/i);
  });
});
