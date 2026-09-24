import { describe, expect, it, vi } from "vitest";
import type { EvalCase } from "./dataset";
import {
  ADEQUACY_REPORT_SCHEMA,
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
import { firstJsonObject } from "./groundedness";

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

  /**
   * #342: `;` and `:` are not sentence ends. #305's run scored the first
   * figure of a semicolon-joined pair "present but uncited" — the adequacy
   * lane on `ho-rebajar-multa-si-pago-ya`, the abstention lane on
   * `ho-abs-calculo-personalizado` — against sentences whose marker sat at
   * their end. These are those two sentences, as the model wrote them.
   */
  it("lets a marker after a semicolon vouch for the figure before it (#342)", () => {
    expect(
      checkLiteral(
        "- Si subsana de forma espontánea, sin que haya mediado ninguna " +
          "actuación de la Administración Tributaria, la sanción se reduce " +
          "en un 75%; si además autoliquida y paga la sanción en ese mismo " +
          "momento, la reducción sube a 80% [1].",
        ["75 %", "75%", "setenta y cinco por ciento"],
      ),
    ).toEqual({ found: true, cited: true });
    expect(
      checkLiteral(
        "Una vez calculado el impuesto según esa escala, la ley reconoce un " +
          "crédito fiscal por cada hijo de ¢20.520,00 anuales; como usted " +
          "indica que tiene dos hijos, ese crédito se aplicaría por cada uno " +
          "de ellos, restándose del impuesto ya determinado [4].",
        ["¢20.520,00", "20.520"],
      ),
    ).toEqual({ found: true, cited: true });
  });

  it("lets a marker after a colon vouch for the figure before it (#342)", () => {
    expect(
      checkLiteral(
        "El salario base es ¢462.200: sobre él se calcula la multa [5].",
        ["¢462.200"],
      ).cited,
    ).toBe(true);
  });

  it("still stops at the period, whatever follows the semicolon (#342)", () => {
    // The widening is to the orthographic sentence, not the paragraph: a
    // marker on the next sentence vouches for nothing, as before.
    expect(
      checkLiteral(
        "La sanción se reduce en un 75%; si paga, sube a 80%. " +
          "Así lo dice el artículo 88 [1].",
        ["75 %", "75%"],
      ),
    ).toEqual({ found: true, cited: false });
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

  /**
   * #289, second harness defect, caught by a smoke run: prompt rule 11
   * explicitly permits tables "cuando los datos sean realmente tabulares,
   * como tramos, plazos o montos", and the escala answers use them. A table
   * row ends in a newline, and the window ended at the first newline, so a
   * figure in a cell could never be scored as cited however the answer cited
   * the table — the prompt asked for tables and the check forbade them. The
   * window now runs to the end of the table block for a figure inside one.
   */
  it("lets a table's citation vouch for a figure in its rows (#289)", () => {
    const answer = [
      "La escala del IVM es la siguiente:",
      "",
      "| Categoría | Nivel de ingreso | Afiliado |",
      "|---|---|---|",
      "| 1 | Hasta 0.87 SM | 4.16% |",
      "| 3 | De 2 SM a menos de 4 SM | 7.53% |",
      "",
      "Estos porcentajes rigen a partir del 1 de enero de 2026 [6].",
    ].join("\n");
    expect(checkLiteral(answer, ["7,53 %", "7,53%"])).toEqual({
      found: true,
      cited: true,
    });
    // A mid-table row, not just the last one.
    expect(checkLiteral(answer, ["4,16 %", "4,16%"]).cited).toBe(true);
  });

  it("does not let a table vouch for a figure outside it (#289)", () => {
    // The widening is scoped to figures *in* a table. A bare paragraph before
    // a cited table is still an uncited paragraph.
    const answer = [
      "La cuota de Salud es 2.89% y no la respalda nada.",
      "",
      "| Categoría | Afiliado |",
      "|---|---|",
      "| 1 | 4.16% |",
      "",
      "Fuente de la tabla [6].",
    ].join("\n");
    expect(checkLiteral(answer, ["2,89 %", "2,89%"])).toEqual({
      found: true,
      cited: false,
    });
  });

  it("still refuses a table that cites nothing at all (#289)", () => {
    const answer = [
      "| Categoría | Afiliado |",
      "|---|---|",
      "| 3 | 7.53% |",
      "",
      "Confirme el dato con la CCSS.",
    ].join("\n");
    expect(checkLiteral(answer, ["7,53 %", "7,53%"])).toEqual({
      found: true,
      cited: false,
    });
  });

  /**
   * Scope, pinned deliberately rather than left to chance: `TABLE_ROW` matches
   * the form prompt rule 11 dictates — «tablas simples con barras verticales
   * (| columna | columna |)» — and markdown's pipe-less variant is not
   * widened for.
   *
   * Recognising a row by "contains a pipe" would let a prose sentence that
   * happens to carry one borrow a citation from further down the answer. For
   * an eval-integrity check the two errors are not symmetric: missing a cited
   * figure fails loudly and gets investigated, while vouching for an uncited
   * one passes silently and is exactly what #131 and #261 req. 3 exist to
   * prevent. So the check stays narrow, and if the answer model ever starts
   * writing pipe-less tables, this test is where that shows up.
   */
  it("does not widen for a table without outer pipes (#289 scope)", () => {
    const answer = [
      "Tramo | Tarifa",
      "--- | ---",
      "1 | 7.53%",
      "",
      "Fuente [6].",
    ].join("\n");
    expect(checkLiteral(answer, ["7,53 %", "7,53%"])).toEqual({
      found: true,
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

describe("checkLiteral on a table whose citation precedes it (#290)", () => {
  const ANSWER = [
    "Los tramos vigentes para 2026 son los siguientes [3]:",
    "",
    "| Tramo | Tarifa |",
    "| --- | --- |",
    "| Hasta ¢6.244.000,00 | exento |",
    "| Exceso | 10% |",
    "",
    "El período va del 1 de enero al 31 de diciembre [3].",
  ].join("\n");

  it("counts a cell figure as cited when the lead-in carries the marker", () => {
    expect(checkLiteral(ANSWER, ["¢6.244.000,00"])).toEqual({
      found: true,
      cited: true,
    });
  });

  it("does not let the lead-in vouch for prose outside the table", () => {
    const prose = "Los tramos son los siguientes [3]:\n\nLa tarifa es 13 %.";
    expect(checkLiteral(prose, ["13 %"])).toEqual({
      found: true,
      cited: false,
    });
  });

  it("reaches no further back than the sentence that introduces the table", () => {
    const far = [
      "El impuesto es anual [3]. Los tramos son estos:",
      "",
      "| Tramo | Tarifa |",
      "| Hasta ¢6.244.000,00 | exento |",
    ].join("\n");
    expect(checkLiteral(far, ["¢6.244.000,00"])).toEqual({
      found: true,
      cited: false,
    });
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

  describe("on the model route, with the fragments behind the answer (#290)", () => {
    const SOURCES = ["La tarifa general del impuesto es del 13%.", "¢462.200"];

    it("clears a corpus figure the answer cites while declining", () => {
      expect(
        figureMentions(
          "Ninguna fuente fija la tarifa de 2027. Hoy la tarifa general es " +
            "del 13 % [2].",
          SOURCES,
        ),
      ).toEqual([]);
    });

    it("keeps a figure no fragment carries", () => {
      expect(
        figureMentions("En 2027 la tarifa será del 4 % [2].", SOURCES),
      ).toEqual(["4 %"]);
    });

    it("keeps a corpus figure the answer prints without a citation", () => {
      // Unattributable is unattributable, whatever the corpus holds: the
      // #131/#261 rule this check shares with the literal ones.
      expect(figureMentions("La tarifa general es del 13 %.", SOURCES)).toEqual(
        ["13 %"],
      );
    });

    it("clears a corpus figure whose marker follows a semicolon (#342)", () => {
      // Arm A of #305 flagged ¢20.520,00 and 75% as invented on
      // `ho-abs-calculo-personalizado`: both in the fragments, both cited,
      // both cut off from their marker at a `;`.
      expect(
        figureMentions(
          "La ley reconoce un crédito fiscal por cada hijo de ¢20.520,00 " +
            "anuales; como usted indica que tiene dos hijos, se aplicaría " +
            "por cada uno [4].",
          [
            ...SOURCES,
            "un crédito de veinte mil quinientos veinte colones (¢20.520,00) anuales",
          ],
        ),
      ).toEqual([]);
    });

    it("clears a system-derived figure, which is in no fragment by design", () => {
      expect(
        figureMentions("La base mínima es de ¢346.789 [8][9].", [
          ...SOURCES,
          "¢346.789",
        ]),
      ).toEqual([]);
    });

    it("stays strict when no sources are given — the fallback route", () => {
      expect(figureMentions("Hoy la tarifa general es del 13 % [2].")).toEqual([
        "13 %",
      ]);
    });
  });
});

describe("the report schema (#286 harness)", () => {
  it("describes exactly the three fields the parser then checks", () => {
    const ok = ADEQUACY_REPORT_SCHEMA.safeParse({
      items: [{ index: 1, present: true, reason: "ok" }],
    });
    expect(ok.success).toBe(true);
    // Syntax is the schema's job; the index rules stay the parser's.
    expect(
      ADEQUACY_REPORT_SCHEMA.safeParse({ items: [{ index: 1.5 }] }).success,
    ).toBe(false);
    expect(ADEQUACY_REPORT_SCHEMA.safeParse({}).success).toBe(false);
  });
});

describe("finding the judge's object in what it actually said (#286 harness)", () => {
  const report = '{"items":[{"index":1,"present":true,"reason":"ok"}]}';

  it("stops at the object's own closing brace, not the last one in the reply", () => {
    // The defect this exists for: a greedy /\{[\s\S]*\}/ runs to the last
    // brace in the response, so one trailing sentence with a brace in it made
    // `JSON.parse` fail on a reply whose object was perfectly good — and the
    // throw took a whole paid eval run with it.
    const withProse = `${report}\n\nNota: el criterio {2} no aplica.`;
    expect(firstJsonObject(withProse)).toBe(report);
    expect(parseAdequacyReport(withProse, 1)).toEqual([
      { index: 1, present: true, reason: "ok" },
    ]);
  });

  it("ignores braces inside a reason string", () => {
    const quoted =
      '{"items":[{"index":1,"present":false,"reason":"dice \\"{}\\" y nada más"}]}';
    expect(firstJsonObject(`prefacio ${quoted} epílogo }`)).toBe(quoted);
  });

  it("tolerates fences and surrounding prose, as before", () => {
    expect(firstJsonObject("```json\n" + report + "\n```")).toBe(report);
    expect(firstJsonObject("no hay objeto aquí")).toBeNull();
  });
});
