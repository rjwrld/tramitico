import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  DERIVED_FIGURES,
  evaluateFormula,
  formatCostaRicanColones,
  incompletelyCitedDerivedFigures,
  isDerivedFigureInput,
  parseDerivedFigures,
  pinDerivedFigureInputs,
  pinEnabled,
  quotesDerivedFigure,
  resolveDerivedFigures,
  type DerivedFigure,
  type ResolvedDerivedFigure,
} from "./derived";

function chunk(docKey: string, articulo: string | null): RetrievedChunk {
  return {
    chunkId: `${docKey}-${articulo}`,
    docKey,
    docTitle: docKey,
    norma: null,
    articulo,
    path: [],
    part: 0,
    content: "Contenido oficial.",
    source: {},
    fetchedAt: "2026-09-04T00:00:00Z",
    score: 0.1,
    vectorRank: 1,
    lexicalRank: 1,
  };
}

const BMC_IVM: DerivedFigure = {
  id: "bmc-ivm-2026",
  label: "Base mínima contributiva de IVM 2026",
  formula: "factor * sm.tonc",
  decimals: 0,
  inputs: [
    {
      name: "factor",
      value: 0.87,
      decimals: 2,
      docKey: "ccss-escala-ivm",
      articulo: "Artículo 4°, sesión 9570",
    },
    {
      name: "sm.tonc",
      value: 373_092.3,
      decimals: 2,
      currency: true,
      docKey: "salarios-minimos",
      articulo: "Artículo 1",
    },
  ],
};

describe("evaluateFormula", () => {
  it("evaluates named inputs with arithmetic precedence", () => {
    expect(
      evaluateFormula("factor * sm.tonc + adjustment", {
        factor: 0.87,
        "sm.tonc": 373_092.3,
        adjustment: 10,
      }),
    ).toBeCloseTo(324_600.301);
  });

  it("rejects formulas outside the arithmetic grammar", () => {
    expect(() => evaluateFormula("globalThis.process.exit()", {})).toThrow(
      /formula/i,
    );
  });
});

describe("resolveDerivedFigures", () => {
  it("computes a figure only when every cited input is retrieved", () => {
    const chunks = [
      chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
      chunk("salarios-minimos", "Artículo 1"),
    ];

    expect(resolveDerivedFigures(chunks, [BMC_IVM])).toEqual([
      {
        ...BMC_IVM,
        value: 324_590.301,
        formattedValue: "¢324.590",
        formattedFormula: "0,87 × ¢373.092,30",
        citationMarkers: [1, 2],
      },
    ]);
  });

  it("emits nothing when one input is absent", () => {
    expect(
      resolveDerivedFigures(
        [chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570")],
        [BMC_IVM],
      ),
    ).toEqual([]);
  });

  it("requires the declared artículo, not merely the right document", () => {
    expect(
      resolveDerivedFigures(
        [
          chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
          chunk("salarios-minimos", "Artículo 2"),
        ],
        [BMC_IVM],
      ),
    ).toEqual([]);
  });

  it("loads the audited BMC and salario-base multiples from the manifest", () => {
    const figures = resolveDerivedFigures([
      chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
      chunk("ccss-escala-salud", "Artículo 30°, sesión 8999"),
      chunk("salarios-minimos", "Artículo 1"),
      chunk("cnpt", "Artículo 78"),
      chunk("cnpt", "Artículo 79"),
      chunk("salario-base-2026", "Circular 246-2025"),
    ]);

    expect(DERIVED_FIGURES).toHaveLength(5);
    expect(
      Object.fromEntries(
        figures.map((figure) => [figure.id, figure.formattedValue]),
      ),
    ).toEqual({
      "bmc-ivm-2026": "¢324.590",
      "bmc-sem-2026": "¢346.789",
      "cnpt-articulo-78-multa-mensual-2026": "¢231.100",
      "cnpt-articulo-78-tope-2026": "¢1.386.600",
      "cnpt-articulo-79-multa-declaracion-2026": "¢231.100",
    });
  });

  it("shows a symbolled input as its source writes the multiple (#352)", () => {
    // The escala states «0.9295 SM», not «0,9295 × ¢373.092,30»: an answer
    // that copied the arithmetic spelling carried the number without saying
    // it was a multiple of the salario mínimo.
    const [figure] = resolveDerivedFigures(
      [
        chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
        chunk("salarios-minimos", "Artículo 1"),
      ],
      [
        {
          ...BMC_IVM,
          inputs: [BMC_IVM.inputs[0], { ...BMC_IVM.inputs[1], symbol: "SM" }],
        },
      ],
    );

    expect(figure.formattedFormula).toBe("0,87 SM; SM = ¢373.092,30");
    expect(figure.value).toBeCloseTo(324_590.301);
  });

  it("keeps the × where juxtaposing the symbol would misread the product", () => {
    // «2 ÷ 4 SM» reads as 2 ÷ (4 SM); the formula is (2 ÷ 4) × SM.
    const [figure] = resolveDerivedFigures(
      [
        chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
        chunk("salarios-minimos", "Artículo 1"),
      ],
      [
        {
          ...BMC_IVM,
          formula: "2 / 4 * sm.tonc",
          inputs: [{ ...BMC_IVM.inputs[1], symbol: "SM" }],
        },
      ],
    );

    expect(figure.formattedFormula).toBe("2 ÷ 4 × SM; SM = ¢373.092,30");
  });

  it("displays the manifest's BMC figures with their salario-mínimo basis", () => {
    const formulas = Object.fromEntries(
      resolveDerivedFigures([
        chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
        chunk("ccss-escala-salud", "Artículo 30°, sesión 8999"),
        chunk("salarios-minimos", "Artículo 1"),
        chunk("cnpt", "Artículo 78"),
        chunk("salario-base-2026", "Circular 246-2025"),
      ]).map((figure) => [figure.id, figure.formattedFormula]),
    );

    expect(formulas["bmc-ivm-2026"]).toBe("0,87 SM; SM = ¢373.092,30");
    expect(formulas["bmc-sem-2026"]).toBe("0,9295 SM; SM = ¢373.092,30");
    // No symbol declared: the arithmetic spelling stands.
    expect(formulas["cnpt-articulo-78-multa-mensual-2026"]).toBe(
      "0,50 × ¢462.200",
    );
  });
});

describe("parseDerivedFigures", () => {
  it("rejects a manifest input without an artículo", () => {
    expect(() =>
      parseDerivedFigures({
        documents: [
          {
            derivedFigures: [
              {
                ...BMC_IVM,
                inputs: [{ ...BMC_IVM.inputs[0], articulo: null }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/artículo/i);
  });

  it.each(["", 5])(
    "rejects an input symbol that is not a word: %j",
    (symbol) => {
      expect(() =>
        parseDerivedFigures({
          documents: [
            {
              derivedFigures: [
                {
                  ...BMC_IVM,
                  inputs: [BMC_IVM.inputs[0], { ...BMC_IVM.inputs[1], symbol }],
                },
              ],
            },
          ],
        }),
      ).toThrow(/symbol/i);
    },
  );

  it.each(["", 5])("rejects a group that is not a word: %j", (group) => {
    expect(() =>
      parseDerivedFigures({
        documents: [{ derivedFigures: [{ ...BMC_IVM, group }] }],
      }),
    ).toThrow(/group/i);
  });

  it.each([-1, 11])("rejects output precision %i outside 0..10", (decimals) => {
    expect(() =>
      parseDerivedFigures({
        documents: [{ derivedFigures: [{ ...BMC_IVM, decimals }] }],
      }),
    ).toThrow(/declaration/i);
  });

  it.each([-1, 11])("rejects input precision %i outside 0..10", (decimals) => {
    expect(() =>
      parseDerivedFigures({
        documents: [
          {
            derivedFigures: [
              {
                ...BMC_IVM,
                inputs: [{ ...BMC_IVM.inputs[0], decimals }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/name, value/i);
  });
});

describe("formatCostaRicanColones", () => {
  it("uses the colón sign, dot thousands and comma decimals", () => {
    expect(formatCostaRicanColones(373_092.3, 2)).toBe("¢373.092,30");
    expect(formatCostaRicanColones(346_789.29285, 0)).toBe("¢346.789");
  });
});

describe("incompletelyCitedDerivedFigures", () => {
  const resolved = resolveDerivedFigures(
    [
      chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570"),
      chunk("salarios-minimos", "Artículo 1"),
    ],
    [BMC_IVM],
  );

  it("requires every input marker in the sentence that quotes a figure", () => {
    expect(
      incompletelyCitedDerivedFigures("La base es ¢324.590 [1].", resolved),
    ).toEqual(["bmc-ivm-2026"]);
    expect(
      incompletelyCitedDerivedFigures(
        "La base es ¢324.590 (0,87 × ¢373.092,30) [1][2].",
        resolved,
      ),
    ).toEqual([]);
  });

  // #403: #401's FAQ transcription carries the escala tables, and a T1-F
  // draft copies them — «hasta ¢324.590,999» is the categoría 1 ceiling,
  // cited under the table, not the BMC figure.
  it("does not read a longer number that starts with the figure as a quote", () => {
    expect(
      incompletelyCitedDerivedFigures(
        "| 1 | hasta ¢324.590,999 | 4.16% |\n| 2 | ¢324.590.000 | 5.65% |\n\n[3]",
        resolved,
      ),
    ).toEqual([]);
  });

  it("still reads the figure with zero decimals as a quote", () => {
    expect(
      incompletelyCitedDerivedFigures("La base es ¢324.590,00 [1].", resolved),
    ).toEqual(["bmc-ivm-2026"]);
  });

  it("reads the colón sign ₡ as ¢", () => {
    expect(
      incompletelyCitedDerivedFigures("La base es ₡324.590 [1].", resolved),
    ).toEqual(["bmc-ivm-2026"]);
    expect(
      incompletelyCitedDerivedFigures("La base es ₡324.590 [1][2].", resolved),
    ).toEqual([]);
  });

  it("still checks a real quote beside a skipped table row", () => {
    expect(
      incompletelyCitedDerivedFigures(
        "| 1 | hasta ¢324.590,999 | 4.16% |\n\n[3]\n\nLa base es ¢324.590 [1].",
        resolved,
      ),
    ).toEqual(["bmc-ivm-2026"]);
  });

  it("reads a figure with decimals only to its last decimal", () => {
    const withDecimals: ResolvedDerivedFigure[] = [
      { ...resolved[0], formattedValue: "¢373.092,30", decimals: 2 },
    ];
    expect(
      incompletelyCitedDerivedFigures("Son ¢373.092,305 [1].", withDecimals),
    ).toEqual([]);
    expect(
      incompletelyCitedDerivedFigures("Son ¢373.092,30 [1].", withDecimals),
    ).toEqual(["bmc-ivm-2026"]);
  });

  it("still checks the quote at the end of a sentence", () => {
    expect(
      incompletelyCitedDerivedFigures(
        "La base es ¢324.590. Así lo fija la escala [1][2].",
        resolved,
      ),
    ).toEqual(["bmc-ivm-2026"]);
  });

  it("does not require markers for a figure the answer does not quote", () => {
    expect(
      incompletelyCitedDerivedFigures(
        "La escala tiene varios tramos [1].",
        resolved,
      ),
    ).toEqual([]);
  });

  it("checks every occurrence independently", () => {
    expect(
      incompletelyCitedDerivedFigures(
        "La base es ¢324.590 [1][2]. Repetimos: ¢324.590 [1].",
        resolved,
      ),
    ).toEqual(["bmc-ivm-2026"]);
  });

  it("distinguishes equal amounts by their non-shared input marker", () => {
    const equalAmounts: ResolvedDerivedFigure[] = [
      {
        ...resolved[0],
        id: "articulo-78",
        formattedValue: "¢231.100",
        citationMarkers: [1, 3],
      },
      {
        ...resolved[0],
        id: "articulo-79",
        formattedValue: "¢231.100",
        citationMarkers: [2, 3],
      },
    ];

    expect(
      incompletelyCitedDerivedFigures(
        "Por declaración son ¢231.100 [2][3].",
        equalAmounts,
      ),
    ).toEqual([]);
    expect(
      incompletelyCitedDerivedFigures(
        "Por declaración son ¢231.100 [2].",
        equalAmounts,
      ),
    ).toEqual(["articulo-79"]);
  });
});

describe("pinDerivedFigureInputs", () => {
  beforeEach(() => {
    // On by default since the pin-at-8 reading; the stub keeps every case
    // below on the pipeline of record whatever the shell says.
    vi.stubEnv("PIN_DERIVED_INPUTS", "on");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const escala = chunk("ccss-escala-ivm", "Artículo 4°, sesión 9570");
  const salarios = chunk("salarios-minimos", "Artículo 1");
  const other = chunk("ley-iva", "Artículo 10");

  it("appends the input the rerank cut when its sibling survived (#287)", () => {
    const pinned = pinDerivedFigureInputs(
      [other, escala],
      [other, escala, salarios],
      [BMC_IVM],
    );
    expect(pinned).toEqual([other, escala, salarios]);
    // Appending, not replacing: the figure resolves and the markers the
    // surviving chunks already had keep their positions.
    expect(resolveDerivedFigures(pinned, [BMC_IVM])[0].citationMarkers).toEqual(
      [2, 3],
    );
  });

  it("leaves the answer set alone when no input survived the cut", () => {
    const answerSet = [other];
    expect(
      pinDerivedFigureInputs(answerSet, [other, escala, salarios], [BMC_IVM]),
    ).toEqual(answerSet);
  });

  it("leaves the answer set alone when the missing input is not in the pool", () => {
    expect(
      pinDerivedFigureInputs([escala], [escala, other], [BMC_IVM]),
    ).toEqual([escala]);
  });

  it("adds nothing when every input is already there", () => {
    const answerSet = [escala, salarios];
    expect(pinDerivedFigureInputs(answerSet, answerSet, [BMC_IVM])).toEqual(
      answerSet,
    );
  });

  it("does not let one figure's pinned input qualify the next (#295 review)", () => {
    // Two figures sharing `salarios-minimos`: the first is eligible and pins
    // it, the second has nothing of its own in the answer set. Judging
    // eligibility on the growing list would chain one append into another.
    const escalaSalud = chunk("ccss-escala-salud", "Artículo 30°, sesión 8999");
    const bmcSem: DerivedFigure = {
      ...BMC_IVM,
      id: "bmc-sem-2026",
      inputs: [
        BMC_IVM.inputs[1],
        {
          ...BMC_IVM.inputs[0],
          docKey: "ccss-escala-salud",
          articulo: "Artículo 30°, sesión 8999",
        },
      ],
    };

    expect(
      pinDerivedFigureInputs(
        [escala],
        [escala, salarios, escalaSalud],
        [BMC_IVM, bmcSem],
      ),
    ).toEqual([escala, salarios]);
  });

  it("never duplicates a chunk two figures both need", () => {
    const salud = chunk("ccss-escala-salud", "Artículo 30°, sesión 8999");
    const bmcSem: DerivedFigure = {
      ...BMC_IVM,
      id: "bmc-sem-2026",
      inputs: [
        {
          ...BMC_IVM.inputs[0],
          docKey: "ccss-escala-salud",
          articulo: "Artículo 30°, sesión 8999",
        },
        BMC_IVM.inputs[1],
      ],
    };
    const pinned = pinDerivedFigureInputs(
      [escala, salud],
      [escala, salud, salarios],
      [BMC_IVM, bmcSem],
    );
    expect(pinned).toEqual([escala, salud, salarios]);
  });

  describe("a declared group (#287)", () => {
    const salud = chunk("ccss-escala-salud", "Artículo 30°, sesión 8999");
    const bmcSem: DerivedFigure = {
      ...BMC_IVM,
      id: "bmc-sem-2026",
      inputs: [
        {
          ...BMC_IVM.inputs[0],
          docKey: "ccss-escala-salud",
          articulo: "Artículo 30°, sesión 8999",
        },
        BMC_IVM.inputs[1],
      ],
    };
    const grouped = [
      { ...BMC_IVM, group: "bmc-2026" },
      { ...bmcSem, group: "bmc-2026" },
    ];

    it("makes a figure eligible when its group's other half survived (#403's losing run)", () => {
      // The rerank kept the SEM escala and cut the IVM one; salarios-minimos
      // is in the pool. Ungrouped, only SEM resolves and the IVM base is
      // never printed.
      expect(
        pinDerivedFigureInputs(
          [other, salud],
          [other, salud, salarios, escala],
          [BMC_IVM, bmcSem],
        ),
      ).toEqual([other, salud, salarios]);
      const pinned = pinDerivedFigureInputs(
        [other, salud],
        [other, salud, salarios, escala],
        grouped,
      );
      expect(pinned).toEqual([other, salud, escala, salarios]);
      expect(
        resolveDerivedFigures(pinned, grouped).map((figure) => figure.id),
      ).toEqual(["bmc-ivm-2026", "bmc-sem-2026"]);
    });

    it("still pins nothing when no member of the group survived", () => {
      expect(
        pinDerivedFigureInputs(
          [other],
          [other, salud, salarios, escala],
          grouped,
        ),
      ).toEqual([other]);
    });

    it("is declared in the manifest for the two BMC bases", () => {
      const groups = DERIVED_FIGURES.filter((figure) =>
        figure.id.startsWith("bmc-"),
      ).map((figure) => figure.group);
      expect(groups).toEqual(["bmc-2026", "bmc-2026"]);
    });
  });

  it("labels the art. 79 fine without a count the article does not state (#352)", () => {
    // Art. 79 fines «los sujetos pasivos que omitan presentar las
    // declaraciones» and says nothing about how many times. The label is
    // handed to both the answer and the judge; «por cada declaración omitida»
    // there was copied into the answer as a count, and the judge accepted it.
    const label = DERIVED_FIGURES.find(
      (figure) => figure.id === "cnpt-articulo-79-multa-declaracion-2026",
    )?.label;
    expect(label).toBeDefined();
    expect(label).not.toMatch(/por cada|cada declaración|por declaración/i);
  });

  it("isDerivedFigureInput names the audited sources of every declared input", () => {
    expect(isDerivedFigureInput(escala, [BMC_IVM])).toBe(true);
    expect(isDerivedFigureInput(salarios, [BMC_IVM])).toBe(true);
    expect(isDerivedFigureInput(other, [BMC_IVM])).toBe(false);
    expect(
      isDerivedFigureInput(chunk("salario-base-2026", "Circular 246-2025")),
    ).toBe(true);
  });

  it("is on by default, and when CI interpolates an unset variable as empty", () => {
    // The pipeline of record since the pin-at-8 reading (ADR 0018): unset
    // and "" both pin, the way RERANK and EXPAND read their variables.
    for (const value of ["", "on"]) {
      vi.stubEnv("PIN_DERIVED_INPUTS", value);
      expect(pinEnabled()).toBe(true);
      expect(
        pinDerivedFigureInputs([escala], [escala, salarios], [BMC_IVM]),
      ).toEqual([escala, salarios]);
    }
  });

  it("pins nothing under PIN_DERIVED_INPUTS=off — the measured baseline", () => {
    vi.stubEnv("PIN_DERIVED_INPUTS", "off");
    expect(pinEnabled()).toBe(false);
    expect(
      pinDerivedFigureInputs([escala], [escala, salarios], [BMC_IVM]),
    ).toEqual([escala]);
  });
});

describe("quotesDerivedFigure", () => {
  const figure = { formattedValue: "¢324.590", decimals: 0 };

  it("reads the figure the way the citation check does (#403)", () => {
    expect(quotesDerivedFigure("La base es ₡324.590 [1][2].", figure)).toBe(
      true,
    );
    expect(quotesDerivedFigure("La base es ¢324.590,00.", figure)).toBe(true);
    expect(quotesDerivedFigure("| 1 | hasta ¢324.590,999 |", figure)).toBe(
      false,
    );
    expect(quotesDerivedFigure("La escala tiene tramos [1].", figure)).toBe(
      false,
    );
  });
});
