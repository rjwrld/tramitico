import { describe, expect, it, vi } from "vitest";
import type { EvalCase } from "./dataset";
import {
  buildAbstentionPrompt,
  buildAdequacyPrompt,
  checkLiteral,
  checkLiterals,
  declineAdequacy,
  figureMentions,
  judgeAbstention,
  judgeAdequacy,
  judgedRequirements,
  literalFailures,
  missingRequirements,
  parseAbstentionVerdict,
  parseAdequacyReport,
  reportVerdict,
  type Requirement,
  type RequirementVerdict,
} from "./adequacy";

const CASE: EvalCase = {
  id: "iva-tarifa",
  seed: "corpus",
  question: "¿Cuánto IVA cobro?",
  expected: [{ docKey: "ley-iva", articulo: "Artículo 10" }],
  blocking: true,
  tier: 1,
  // Not a held-out case: a hand-written fixture for the judge, so it
  // carries no variant and must not claim membership in the set.
  heldOut: false,
  family: "T1-D",
  requiredClaims: [
    { claim: "la tarifa general es 13 %", literal: ["13 %", "13%"] },
    { claim: "el hecho generador ocurre al prestar el servicio" },
  ],
  requiredSteps: ["declarar en TRIBU-CR"],
};

describe("judgedRequirements", () => {
  it("sends prose claims and steps to the judge and keeps literals out", () => {
    expect(judgedRequirements(CASE)).toEqual([
      {
        kind: "claim",
        text: "el hecho generador ocurre al prestar el servicio",
      },
      { kind: "step", text: "declarar en TRIBU-CR" },
    ]);
  });

  it("is empty for a case that declares no requirements", () => {
    expect(
      judgedRequirements({
        ...CASE,
        requiredClaims: undefined,
        requiredSteps: undefined,
      }),
    ).toEqual([]);
  });
});

describe("checkLiteral", () => {
  it("passes a figure cited in its own sentence", () => {
    expect(
      checkLiteral(
        "La tarifa general del IVA es 13 % [2]. Se declara mensualmente.",
        ["13 %"],
      ),
    ).toEqual({ found: true, cited: true });
  });

  it("normalizes the non-breaking space on both sides", () => {
    expect(checkLiteral("es del 13 % [1].", ["13 %"]).cited).toBe(true);
    expect(checkLiteral("es del 13 % [1].", ["13 %"]).cited).toBe(true);
  });

  it("accepts any one spelling variant", () => {
    expect(checkLiteral("la tarifa es 13% [4].", ["13 %", "13%"]).cited).toBe(
      true,
    );
  });

  it("reports a figure that appears without a citation in its sentence", () => {
    expect(
      checkLiteral("La tarifa es 13 %. El plazo es el día 15 [3].", ["13 %"]),
    ).toEqual({ found: true, cited: false });
  });

  it("does not let a later sentence's citation vouch for the figure", () => {
    expect(checkLiteral("Es 13 %\nOtra cosa [1]", ["13 %"]).cited).toBe(false);
  });

  it("reports an absent figure as absent, not merely uncited", () => {
    expect(checkLiteral("La tarifa es del 4 % [1].", ["13 %"])).toEqual({
      found: false,
      cited: false,
    });
  });

  it("keeps the window open across the dots inside a monto", () => {
    expect(
      checkLiteral("El salario base 2026 es ¢462.200 según el Boletín [5].", [
        "¢462.200",
      ]).cited,
    ).toBe(true);
  });

  it("finds a citation on the last sentence, which has no terminator", () => {
    expect(checkLiteral("El plazo es el día 15 [2]", ["día 15"]).cited).toBe(
      true,
    );
  });

  /**
   * #289: the CCSS actas write every rate with a period — "2.89%", "0.9295
   * SM", "6.24%" — and prompt rule 3 forbids the model from rewriting a
   * figure it was given. The dataset writes the same rates the Spanish way,
   * with a comma. A separator-sensitive check therefore scored transcription,
   * not adequacy, and marked five satisfiable claims "absent" in the 2026
   * baseline. Digits still have to match; only the separator between them is
   * read as the same character on both sides.
   */
  it("reads a decimal separator the same on both sides (#289)", () => {
    expect(checkLiteral("La cuota es 2.89% [1].", ["2,89 %", "2,89%"])).toEqual(
      { found: true, cited: true },
    );
    expect(
      checkLiteral("La base mínima es 0,9295 SM [3].", ["0.9295 SM"]).cited,
    ).toBe(true);
    expect(
      checkLiteral("El salario base es ¢462,200 [5].", ["¢462.200"]).cited,
    ).toBe(true);
  });

  it("still refuses a different figure (#289 does not blur digits)", () => {
    expect(checkLiteral("La cuota es 2.98% [1].", ["2,89 %"])).toEqual({
      found: false,
      cited: false,
    });
  });

  it("leaves a sentence-ending period a sentence end (#289)", () => {
    // The separator rewrite must not touch the "." that closes a sentence,
    // or the citation window would run past it and a later marker would
    // vouch for an uncited figure.
    expect(
      checkLiteral("La cuota es 2,89 %. Se paga mensualmente [1].", ["2,89 %"]),
    ).toEqual({ found: true, cited: false });
  });
});

describe("checkLiterals", () => {
  it("rows only the claims that declare a literal", () => {
    const checks = checkLiterals(
      "La tarifa es 13 % [1].",
      CASE.requiredClaims!,
    );
    expect(checks).toEqual([
      {
        claim: "la tarifa general es 13 %",
        variants: ["13 %", "13%"],
        found: true,
        cited: true,
      },
    ]);
    expect(literalFailures(checks)).toEqual([]);
  });

  it("names why each failing literal failed", () => {
    expect(
      literalFailures(
        checkLiterals("La tarifa es 13 %.", CASE.requiredClaims!),
      ),
    ).toEqual(["la tarifa general es 13 % (13 % | 13%: present but uncited)"]);
    expect(
      literalFailures(checkLiterals("Sin cifras.", CASE.requiredClaims!)),
    ).toEqual(["la tarifa general es 13 % (13 % | 13%: absent)"]);
  });
});

describe("buildAdequacyPrompt", () => {
  it("numbers the requirements and marks each kind", () => {
    const prompt = buildAdequacyPrompt(
      "¿Cuánto?",
      judgedRequirements(CASE),
      "Respuesta",
    );
    expect(prompt).toContain(
      "1. [claim] el hecho generador ocurre al prestar el servicio",
    );
    expect(prompt).toContain("2. [step] declarar en TRIBU-CR");
    expect(prompt).toContain("Respuesta");
  });
});

describe("parseAdequacyReport", () => {
  const report = (items: unknown) => JSON.stringify({ items });

  it("parses a fenced report with surrounding prose", () => {
    expect(
      parseAdequacyReport(
        'Here:\n```json\n{"items":[{"index":1,"present":true,"reason":"ok"}]}\n```',
        1,
      ),
    ).toEqual([{ index: 1, present: true, reason: "ok" }]);
  });

  it("defaults a missing reason to the empty string", () => {
    expect(
      parseAdequacyReport(report([{ index: 1, present: false }]), 1)[0].reason,
    ).toBe("");
  });

  it("rejects a report with the wrong number of items", () => {
    expect(() =>
      parseAdequacyReport(report([{ index: 1, present: true }]), 2),
    ).toThrow(/exactly 2/);
  });

  it("rejects a repeated or out-of-range index", () => {
    expect(() =>
      parseAdequacyReport(
        report([
          { index: 1, present: true },
          { index: 1, present: true },
        ]),
        2,
      ),
    ).toThrow(/bad index/);
    expect(() =>
      parseAdequacyReport(report([{ index: 3, present: true }]), 1),
    ).toThrow(/bad index/);
  });

  it("rejects a non-boolean present, rather than reading it as absent", () => {
    expect(() =>
      parseAdequacyReport(report([{ index: 1, present: "yes" }]), 1),
    ).toThrow(/boolean/);
  });

  it("rejects output with no JSON object and malformed JSON", () => {
    expect(() => parseAdequacyReport("no json here", 1)).toThrow(
      /no JSON object/,
    );
    expect(() => parseAdequacyReport("{not json}", 1)).toThrow(
      /malformed JSON/,
    );
  });
});

describe("reportVerdict / missingRequirements", () => {
  const requirements: Requirement[] = [
    { kind: "claim", text: "a" },
    { kind: "step", text: "b" },
  ];

  it("passes only when every requirement is present", () => {
    expect(
      reportVerdict([
        { index: 1, present: true, reason: "" },
        { index: 2, present: true, reason: "" },
      ]),
    ).toBe("pass");
    expect(
      reportVerdict([
        { index: 1, present: true, reason: "" },
        { index: 2, present: false, reason: "" },
      ]),
    ).toBe("fail");
  });

  it("lists the absent requirements in asked order, whatever order they arrive in", () => {
    const items: RequirementVerdict[] = [
      { index: 2, present: false, reason: "" },
      { index: 1, present: false, reason: "" },
    ];
    expect(missingRequirements(requirements, items)).toEqual(["a", "b"]);
  });
});

describe("judgeAdequacy", () => {
  const requirements: Requirement[] = [
    { kind: "claim", text: "la tarifa es 13 %" },
  ];
  const pass: RequirementVerdict[] = [{ index: 1, present: true, reason: "" }];
  const fail: RequirementVerdict[] = [
    { index: 1, present: false, reason: "no rate" },
  ];

  it("makes no call for a case with no prose requirements", async () => {
    const judge = vi.fn();
    expect(await judgeAdequacy("¿?", [], "Respuesta", judge)).toEqual({
      verdict: "pass",
      verdicts: [],
      missing: [],
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it("judges once on a pass", async () => {
    const judge = vi.fn().mockResolvedValue(pass);
    const outcome = await judgeAdequacy("¿?", requirements, "13 % [1]", judge);
    expect(outcome).toEqual({
      verdict: "pass",
      verdicts: ["pass"],
      missing: [],
    });
    expect(judge).toHaveBeenCalledOnce();
  });

  it("re-judges twice on a fail and lets the majority stand", async () => {
    const judge = vi
      .fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(pass)
      .mockResolvedValueOnce(pass);
    const outcome = await judgeAdequacy("¿?", requirements, "…", judge);
    expect(judge).toHaveBeenCalledTimes(3);
    expect(outcome.verdict).toBe("pass");
    expect(outcome.verdicts).toEqual(["fail", "pass", "pass"]);
    // A majority pass carries no missing list: nothing is missing.
    expect(outcome.missing).toEqual([]);
  });

  it("carries the last failing report's missing list on a fail", async () => {
    const judge = vi.fn().mockResolvedValue(fail);
    const outcome = await judgeAdequacy("¿?", requirements, "…", judge);
    expect(outcome.verdict).toBe("fail");
    expect(outcome.missing).toEqual(["la tarifa es 13 %"]);
  });
});

describe("declineAdequacy", () => {
  it("fails with every requirement missing and no judge call", () => {
    expect(declineAdequacy(judgedRequirements(CASE))).toEqual({
      verdict: "fail",
      verdicts: [],
      missing: [
        "el hecho generador ocurre al prestar el servicio",
        "declarar en TRIBU-CR",
      ],
    });
  });
});

describe("parseAbstentionVerdict", () => {
  it("passes only when it both declined and routed", () => {
    expect(
      parseAbstentionVerdict('{"declined":true,"routed":true,"reason":"ok"}')
        .verdict,
    ).toBe("pass");
    expect(
      parseAbstentionVerdict(
        '{"declined":true,"routed":false,"reason":"dead end"}',
      ).verdict,
    ).toBe("fail");
    expect(
      parseAbstentionVerdict('{"declined":false,"routed":true}').verdict,
    ).toBe("fail");
  });

  it("rejects missing or non-boolean fields", () => {
    expect(() => parseAbstentionVerdict('{"declined":true}')).toThrow(
      /boolean/,
    );
    expect(() =>
      parseAbstentionVerdict('{"declined":"si","routed":true}'),
    ).toThrow(/boolean/);
  });

  it("rejects output with no JSON object and malformed JSON", () => {
    expect(() => parseAbstentionVerdict("nope")).toThrow(/no JSON object/);
    expect(() => parseAbstentionVerdict("{nope}")).toThrow(/malformed JSON/);
  });
});

describe("buildAbstentionPrompt", () => {
  it("names the expected route, or says the competent institution when none is given", () => {
    expect(
      buildAbstentionPrompt("¿Cuánto cobro por hora?", "No puedo…", {
        abstainIf: "fuera de alcance",
        routeTo: "un colegio profesional",
      }),
    ).toContain("un colegio profesional");
    expect(
      buildAbstentionPrompt("¿?", "No puedo…", {
        abstainIf: "fuera de alcance",
      }),
    ).toContain("la institución competente");
  });
});

describe("judgeAbstention", () => {
  const context = { abstainIf: "fuera de alcance", routeTo: "el MTSS" };
  const verdict = (declined: boolean, routed: boolean) => ({
    declined,
    routed,
    verdict: declined && routed ? ("pass" as const) : ("fail" as const),
    reason: declined && routed ? "" : "answered anyway",
  });

  it("judges once on a pass", async () => {
    const judge = vi.fn().mockResolvedValue(verdict(true, true));
    expect(await judgeAbstention("¿?", "No puedo…", context, judge)).toEqual({
      verdict: "pass",
      verdicts: ["pass"],
      reason: "",
    });
  });

  it("re-judges twice on a fail and lets the majority stand", async () => {
    const judge = vi
      .fn()
      .mockResolvedValueOnce(verdict(false, false))
      .mockResolvedValueOnce(verdict(false, false))
      .mockResolvedValueOnce(verdict(true, true));
    const outcome = await judgeAbstention(
      "¿?",
      "El aguinaldo es…",
      context,
      judge,
    );
    expect(judge).toHaveBeenCalledTimes(3);
    expect(outcome.verdict).toBe("fail");
    expect(outcome.reason).toBe("answered anyway");
  });
});

describe("figureMentions", () => {
  it("finds colón amounts and percentages, deduped", () => {
    expect(
      figureMentions("Son ¢462.200 y ₡1.000, con 13 % y 13 % y 0,5%."),
    ).toEqual(["¢462.200", "₡1.000", "13 %", "0,5%"]);
  });

  it("ignores the plain integers an honest routing sentence carries", () => {
    expect(
      figureMentions("Consulte el artículo 5; resuelven en 20 días hábiles."),
    ).toEqual([]);
  });
});
