import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../../corpus/manifest.json";
import {
  ARTICULO_DOCS,
  FIGURES,
  articuloNumber,
  citedChunks,
  corpusCoverage,
  detectAbsenceClaims,
  sentences,
} from "./absence";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "./corpus-index";

// The committed index: the detector's verdicts below are verdicts about the
// corpus as it is, which is the point of the check (#500).
const coverage = corpusCoverage(
  parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8")),
);

function falseTargets(
  answer: string,
  cited: { docKey: string }[] = [],
): string[] {
  return detectAbsenceClaims(answer, { cited, coverage }).falseClaims.map(
    (claim) => claim.target,
  );
}

describe("articuloNumber", () => {
  it.each([
    ["Artículo 10", "10"],
    ["ARTICULO 2", "2"],
    ["Articulo 38 quater", "38 quater"],
    ["Artículo 11 bis", "11 bis"],
    ["Artículo 4°, sesión 9570", "4"],
  ])("%s → %s", (label, number) => {
    expect(articuloNumber(label)).toBe(number);
  });

  it.each([
    "Preámbulo",
    "TRANSITORIO I",
    "¿Cómo me retiro de mi Seguro Voluntario?",
  ])("%s is no numbered artículo", (label) => {
    expect(articuloNumber(label)).toBeNull();
  });
});

describe("the tables", () => {
  const docKeys = new Set(manifest.documents.map((doc) => doc.doc_key));

  it("names only documents the manifest carries", () => {
    const named = [
      ...ARTICULO_DOCS.map((doc) => doc.docKey),
      ...FIGURES.flatMap((figure) => figure.requires.map((r) => r.docKey)),
    ];
    expect(named.filter((docKey) => !docKeys.has(docKey))).toEqual([]);
  });

  it("dates each figure by its newest source (the 2027 cliff, #505)", () => {
    // `years` is hand-written. When a re-crawl ingests next year's escala or
    // wage decree, its effective_date moves past them and this goes red, so
    // a «BMC de 2027» claim stops being excused as a year the corpus lacks.
    const effective = new Map(
      manifest.documents.map((doc) => [
        doc.doc_key,
        "effective_date" in doc && typeof doc.effective_date === "string"
          ? Number(doc.effective_date.slice(0, 4))
          : null,
      ]),
    );
    const stale = FIGURES.flatMap((figure) => {
      const newest = Math.max(
        ...figure.requires.map(({ docKey }) => effective.get(docKey) ?? 0),
      );
      return figure.years === null ||
        newest === 0 ||
        figure.years.includes(newest)
        ? []
        : [`${figure.label}: newest source ${newest}`];
    });
    expect(stale).toEqual([]);
  });

  it("covers every figure in the committed index", () => {
    // A figure whose document left the corpus would make every claim about it
    // honest — right, but the table should then lose the row.
    const uncovered = FIGURES.filter((figure) =>
      figure.requires.some(
        ({ docKey, articulo }) =>
          !(articulo === undefined
            ? coverage.articulos.has(docKey)
            : coverage.articulos.get(docKey)?.has(articulo)),
      ),
    ).map((figure) => figure.label);
    expect(uncovered).toEqual([]);
  });
});

describe("detectAbsenceClaims: Ley IVA art. 10 (ho-abs-iva-2027)", () => {
  // Verbatim from the committed transcripts #500 names, all scored pass.
  it.each([
    [
      "2026-09-22-effort-medium",
      "Los documentos oficiales proporcionados no contienen el artículo 10 de la Ley del Impuesto sobre el Valor Agregado, que es donde se establecería la tarifa general del IVA, ni ninguna disposición que fije o proyecte una tasa distinta para el año 2027 específicamente.",
    ],
    [
      "2026-09-24-pin1 (off)",
      "Los documentos oficiales proporcionados no contienen una tarifa general del IVA para 2027.\n\nNinguno de los documentos provistos menciona el artículo 10 con su porcentaje, ni contiene un cambio de tarifa programado para el año 2027.",
    ],
    [
      "2026-09-29-451 (abstention-checks)",
      "- La tarifa general está prevista en el artículo 10 de la Ley del IVA, y el reglamento se refiere a ella como la «tarifa general del 13%» [7]. El artículo 10 no aparece en los documentos oficiales que consulté, así que la cifra del 13% la respalda solo esa mención del reglamento.",
    ],
    [
      "2026-09-29-454",
      "- La tarifa general está en el artículo 10 de la ley, pero los documentos provistos no traen su porcentaje [3].",
    ],
    [
      "2026-10-02-full-lane",
      "- El Reglamento se refiere a una tarifa general del 13% [7]. La ley remite a la tarifa general del artículo 10, que los documentos provistos no reproducen [1].",
    ],
  ])("flags %s", (_run, answer) => {
    expect(falseTargets(answer)).toHaveLength(1);
  });

  it("resolves a bare «artículo 10» against the cited documents", () => {
    const answer =
      "La ley remite a la tarifa general del artículo 10, que los documentos no reproducen [1].";
    expect(falseTargets(answer, [{ docKey: "ley-iva" }])).toEqual([
      "ley-iva · Artículo 10",
    ]);
  });

  it("flags «Sobre la tarifa general, … su porcentaje»", () => {
    expect(
      falseTargets(
        "Sobre la tarifa general, los documentos no traen su porcentaje.",
      ),
    ).toEqual(["tarifa general del IVA"]);
  });
});

describe("detectAbsenceClaims: other false claims", () => {
  it("flags factura-primera-cabys's «no traen el catálogo»", () => {
    expect(
      falseTargets(
        "Sobre el código CABYS no encuentro base oficial en los documentos que consulté: no traen el catálogo ni dicen cómo escoger el código.",
      ),
    ).toEqual(["CABYS"]);
  });

  it("flags a figure in the second conjunct", () => {
    expect(
      falseTargets(
        "Los documentos no traen el procedimiento ni el plazo de inscripción ante Hacienda, ni el valor actual de la BMC; confírmelos con la CCSS.",
      ),
    ).toEqual(["BMC"]);
  });

  it("flags a figure as the subject of «no está en las fuentes»", () => {
    expect(
      falseTargets(
        "Como el dato del salario mínimo vigente y el monto exacto de la BMC no están en las fuentes que tengo, le recomiendo confirmarlo con la CCSS.",
      ),
    ).toEqual(["salario mínimo"]);
  });

  it("flags a list of artículos of a named reglamento", () => {
    expect(
      falseTargets(
        "Los documentos no detallan el contenido de los artículos 32, 33 y 36 del Reglamento del IVA.",
      ),
    ).toEqual(["reglamento-iva · Artículo 32, 33, 36"]);
  });

  it("reads «art. 10» like «artículo 10»", () => {
    expect(
      falseTargets(
        "Los documentos no traen el texto del art. 10 de la Ley del IVA.",
      ),
    ).toEqual(["ley-iva · Artículo 10"]);
  });

  it("flags a subdivision of a covered artículo", () => {
    expect(
      falseTargets(
        "Las fuentes no traen completo el inciso b del numeral 4 del artículo 11 de la Ley del IVA, pues el texto aparece cortado.",
      ),
    ).toEqual(["ley-iva · Artículo 11"]);
  });

  it("does not let a conjunction inside the target split it", () => {
    expect(
      falseTargets(
        "Los documentos no contienen el listado del Catálogo de Bienes y Servicios.",
      ),
    ).toEqual(["CABYS"]);
  });
});

describe("detectAbsenceClaims: honest abstentions", () => {
  it.each([
    // A future rate.
    "Los documentos oficiales no traen ninguna tarifa del IVA para 2027, y ninguna fuente puede decir cuál será a futuro.",
    "Los documentos oficiales disponibles no contienen ninguna cifra proyectada ni futura para la tarifa del IVA en 2027.",
    // A personalized calculation.
    "Los documentos oficiales no traen su caso personal ni una liquidación, así que la operación con sus cifras la debe hacer usted.",
    "Para ubicarse en la escala, los documentos no traen sus ingresos netos como independiente, así que ese es el dato que falta.",
    // An artículo the corpus does not carry (CNPT art. 51).
    "Los documentos oficiales no traen el texto del artículo 51 del Código de Normas y Procedimientos Tributarios.",
    // A codification the corpus does not carry.
    "Los documentos oficiales no traen el código de actividad económica (CIIU 4) que corresponde a hacer páginas web.",
    // Something about an artículo, not the artículo itself.
    "Los documentos no precisan cómo se cuenta la sanción del artículo 79 del Código de Normas y Procedimientos Tributarios cuando se omiten varios períodos.",
    "Los documentos no indican el formulario ni el canal para autoliquidar esta sanción del artículo 78 del Código de Normas y Procedimientos Tributarios.",
    // A rate the corpus does not set: there is no reduced rate for software.
    "Los documentos oficiales provistos no traen una tarifa reducida ni una exención específica para servicios de desarrollo de software.",
    // Another version of a figure.
    "Los documentos no indican una escala posterior distinta para el Seguro de Salud.",
    // A procedure, under a figure topic.
    "Sobre el código CABYS específicamente, los documentos oficiales no detallan cómo buscarlo ni dónde consultarlo.",
  ])("leaves alone: %s", (answer) => {
    expect(falseTargets(answer)).toEqual([]);
  });

  it("does not resolve a bare artículo when its candidates disagree", () => {
    // ley-iva carries art. 10; the CNPT excerpt does not.
    expect(
      falseTargets(
        "El artículo 10 no aparece en los documentos que consulté [1][2].",
        [{ docKey: "ley-iva" }, { docKey: "cnpt" }],
      ),
    ).toEqual([]);
  });
});

describe("detectAbsenceClaims: openings", () => {
  it("reports an opening absence claim, honest or not", () => {
    const report = detectAbsenceClaims(
      "No encuentro base oficial sobre la patente municipal en los documentos que consulté.\n\nConsulte a su municipalidad.",
      { cited: [], coverage },
    );
    expect(report.opening).toBe(
      "No encuentro base oficial sobre la patente municipal en los documentos que consulté.",
    );
    expect(report.falseClaims).toEqual([]);
  });

  it("does not report an answer that opens with the answer", () => {
    const report = detectAbsenceClaims(
      "Sí, debe inscribirse [1]. Los documentos no traen el monto de la BMC.",
      { cited: [], coverage },
    );
    expect(report.opening).toBeNull();
    expect(report.falseClaims.map((claim) => claim.target)).toEqual(["BMC"]);
  });
});

describe("sentences", () => {
  it("does not split «art. 10» or «4.b»", () => {
    expect(
      sentences("Vea el art. 10 de la ley. El inciso 4.b está cortado.\nFin."),
    ).toEqual([
      "Vea el art. 10 de la ley.",
      "El inciso 4.b está cortado.",
      "Fin.",
    ]);
  });
});

describe("citedChunks", () => {
  it("returns the chunks the markers cite, once each, skipping strays", () => {
    const chunks = [{ docKey: "a" }, { docKey: "b" }, { docKey: "c" }];
    expect(citedChunks("x [3] y [1][3] z [9]", chunks)).toEqual([
      { docKey: "c" },
      { docKey: "a" },
    ]);
  });
});
