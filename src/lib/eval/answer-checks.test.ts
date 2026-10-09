import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  formatAnswerChecks,
  readerCaseSlips,
  readerCounts,
  withAbsenceGate,
} from "./answer-checks";

// rb-seguimiento-de-cuanto-multa's condensed question, and the chunk pair
// behind CNPT art. 78's two derived figures (¢231.100 a month, tope ¢1.386.600).
const RB_QUERY =
  "¿De cuánto es la multa por no inscribirse en Hacienda habiendo trabajado un año sin registrarse?";
const ART78 = [
  { docKey: "cnpt", articulo: "Artículo 78" },
  { docKey: "salario-base-2026", articulo: "Circular 246-2025" },
];
// multa-iva-no-declarado's question, reworded: the dataset's is held out (#543).
const MULTA_QUERY =
  "¿De cuánto sería la multa si dejé tres meses sin declarar el IVA?";

function slips(answer: string, question: string, chunks = ART78) {
  return readerCaseSlips(answer, { question, chunks }).map(
    ({ kind, sentence }) => ({ kind, sentence }),
  );
}

describe("readerCounts", () => {
  it("reads «un año» as twelve months, and a count in words or digits", () => {
    const [year] = readerCounts(RB_QUERY);
    expect(year.multipliers).toEqual([12]);
    expect(year.phrases).toContain("un ano");
    expect(readerCounts(MULTA_QUERY)[0].multipliers).toEqual([3]);
    expect(
      readerCounts("Tengo 2 hijos, ¿cuánto rebajo?")[0].multipliers,
    ).toEqual([2]);
  });

  it("reads nothing from a question with no count about the reader", () => {
    expect(readerCounts("¿Y de cuánto es la multa?")).toEqual([]);
    expect(readerCounts("¿Cuánto es un mes de multa?")).toEqual([]);
  });
});

describe("readerCaseSlips: the tope (#546)", () => {
  it.each([
    // #556's control, d1 and d3: the judges passed both.
    "Para su caso, un año sin registrarse supera los meses necesarios para llegar al tope.",
    "Para un año sin registrarse, el tope es el límite de lo que puede resultar por esta infracción.",
    // #512's lane 2.
    "En su caso, trabajando un año sin inscribirse, la sanción por mes o fracción de mes ya habría llegado al tope de tres salarios base, que es el máximo que fija la norma [1].",
    // #507's r1: the referral that follows does not undo the reading.
    "Como el tope es el límite de la sanción total, un año de atraso en principio alcanzaría ese tope, pero el cálculo en su caso lo hace Hacienda.",
  ])("flags: %s", (sentence) => {
    expect(slips(sentence, RB_QUERY)).toEqual([{ kind: "tope", sentence }]);
  });

  it.each([
    // #556's round 1, d1 and d2: the count handed back, as rule 3 asks.
    "Aplicar esa regla a su año sin registrarse y decir si llega al tope le corresponde a usted o a Hacienda, porque no calculo su caso.",
    "Como la multa se cuenta por mes o fracción, y la cantidad de meses y el tope los debe aplicar usted o Hacienda a su caso, no calculo el total por usted.",
    // #556's control, d2: the rule, with no reader in it.
    "Como la multa se cuenta por mes o fracción y tiene tope, en principio la cifra mensual se aplica a cada mes sin inscripción hasta llegar a ese tope [1].",
    // 2026-09-15: the reader's count beside a tope the sentence only states.
    "Es decir, si se inscribió un año tarde, la sanción se calcula por los meses transcurridos desde que debió inscribirse, con ese tope de tres salarios base [2].",
  ])("leaves alone: %s", (sentence) => {
    expect(slips(sentence, RB_QUERY)).toEqual([]);
  });

  it("reads nothing without the reader's count", () => {
    expect(
      slips(
        "Para su caso, un año sin registrarse supera los meses necesarios para llegar al tope.",
        "",
      ),
    ).toEqual([]);
  });
});

describe("readerCaseSlips: the product (#546)", () => {
  it("flags a figure multiplied by the reader's children", () => {
    // ho-abs-calculo-personalizado's answer in 2026-09-24's abstention lane;
    // its question, reworded (#543).
    const sentence =
      "Con dos hijos, el crédito anual por hijos sería la suma de ¢20.520,00 por cada uno (es decir, ¢41.040,00 en total), que se resta del impuesto determinado según la tabla anterior [1][3][5].";
    expect(
      readerCaseSlips(sentence, {
        question: "Tengo dos hijos: ¿cuánto me toca pagar de renta?",
        chunks: [],
      }),
    ).toEqual([
      { kind: "product", sentence, detail: "¢20.520,00 × 2 = ¢41.040,00" },
    ]);
  });

  it("flags a derived figure multiplied by a year's months", () => {
    const sentence = "En un año serían ¢2.773.200 de multa.";
    expect(
      slips(`La multa es de ¢231.100 por mes [1][2]. ${sentence}`, RB_QUERY),
    ).toEqual([{ kind: "product", sentence }]);
  });

  it("leaves a derived figure alone, even when it is a product of the count", () => {
    // The tope is 3 × the salario base, and the reader said «tres meses».
    expect(
      slips(
        "La multa es de ¢231.100 (0,50 × ¢462.200) [1][2]. El tope es de ¢1.386.600 (3 × ¢462.200) [1][2].",
        MULTA_QUERY,
      ),
    ).toEqual([]);
  });

  it("leaves alone an amount a chunk states", () => {
    expect(
      readerCaseSlips("El monto es ¢600.000 y la cuota ¢200.000 [1].", {
        question: MULTA_QUERY,
        chunks: [{ docKey: "x", content: "un tope de ¢600.000 por año" }],
      }),
    ).toEqual([]);
  });
});

describe("checkAnswer and the lanes", () => {
  const chunks = [
    { docKey: "cnpt", articulo: "Artículo 79" },
    { docKey: "salario-base-2026", articulo: "Circular 246-2025" },
  ];
  const hedge =
    "Las fuentes no dicen cuántas veces se aplica esa multa si se omiten varias declaraciones.";

  it("gates the count hedge like a false absence claim", () => {
    const checks = checkAnswer(
      `La multa por cada declaración omitida es de ¢231.100 [1][2]. ${hedge}`,
      chunks,
      MULTA_QUERY,
    );
    const judged = withAbsenceGate({ verdict: "pass", reason: "ok" }, checks);
    expect(judged.verdict).toBe("fail");
    expect(formatAnswerChecks([{ id: "multa", checks }])).toContain(
      `false absence claims (#500): 1\n  multa: «Multa por cada declaración tributaria omitida (artículo 79)» says how it is counted — «${hedge}»`,
    );
  });

  it("reports the reader's case, and does not gate it", () => {
    const checks = checkAnswer(
      "La multa es de ¢231.100 por mes [1][2]. Para su caso, un año sin registrarse supera los meses necesarios para llegar al tope.",
      ART78,
      RB_QUERY,
    );
    expect(withAbsenceGate({ verdict: "pass", reason: "ok" }, checks)).toEqual({
      verdict: "pass",
      reason: "ok",
    });
    expect(formatAnswerChecks([{ id: "rb", checks }])).toContain(
      "reader's case worked out (#546, reported): 1 — rb (tope)",
    );
  });

  it("leaves the reader's case unread without a question", () => {
    expect(checkAnswer("Sí [1].", chunks).readerCase).toBeUndefined();
  });

  it("reads a row written before #558, which carries no reader's case", () => {
    const checks = checkAnswer("Sí [1].", chunks);
    expect(formatAnswerChecks([{ id: "old", checks }])).toContain(
      "reader's case worked out (#546, reported): 0",
    );
  });
});
