/**
 * The case #130 was opened for: an answer that is **fully supported and
 * materially incomplete**.
 *
 * Groundedness asks whether every claim is backed by the fragments, so an
 * answer that says "sí, debe asegurarse en la CCSS" and never says what the
 * cuota is passes it — nothing it states is wrong. A reader who asked "¿cuánto
 * pago?" got nothing. That gap is the whole reason the adequacy gate exists,
 * and until this file it was argued rather than demonstrated.
 *
 * The fragments are hand-written, like `conflicting-sources.ts`: the point is
 * to pin the *judges' behavior on a fixed answer*, so retrieval, the answer
 * model and corpus drift must all stay out of it. Both judges see the same
 * pair of fixtures — one rate-less answer, one complete one — which is the
 * positive control: a judge stuck on "fail" would fail the complete answer too,
 * and a judge stuck on "pass" would pass the rate-less one.
 *
 * No database and no embeddings, so it is gated on `ANTHROPIC_API_KEY` alone
 * and runs at the judge cadence beside the groundedness gate:
 *
 *   ANTHROPIC_API_KEY=<key> \
 *   pnpm vitest run src/lib/eval/adequacy.eval.test.ts
 */
import { expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import {
  checkLiterals,
  judgeAdequacy,
  judgedRequirements,
  literalFailures,
} from "./adequacy";
import type { EvalCase } from "./dataset";
import { judgeAnswer } from "./groundedness";

const describeEval = integrationSuite(envPrereqs("ANTHROPIC_API_KEY"));

const QUESTION = "¿Cuánto tengo que pagarle a la Caja como independiente?";

/**
 * Two fabricated fragments shaped like the ones this question really
 * retrieves: the obligation, and the escala that carries the figure. No
 * percentage here is claimed to be current — nothing in this file touches the
 * corpus.
 */
const CHUNKS: RetrievedChunk[] = [
  {
    chunkId: "adequacy-obligacion",
    docKey: "reglamento-ti",
    docTitle:
      "Reglamento para el Aseguramiento Contributivo de los Trabajadores Independientes",
    norma: "Reglamento CCSS",
    articulo: "Artículo 2",
    path: [],
    part: 0,
    content:
      "El aseguramiento de los trabajadores independientes es obligatorio. " +
      "Quien realice una actividad por cuenta propia debe afiliarse y cotizar " +
      "sobre el ingreso de referencia que declare ante la Caja.",
    source: { url: "https://www.ccss.sa.cr/reglamento-ti" },
    fetchedAt: "2026-02-01T10:00:00Z",
    score: 0.031,
    vectorRank: 1,
    lexicalRank: 1,
  },
  {
    chunkId: "adequacy-escala",
    docKey: "ccss-escala-salud",
    docTitle:
      "Escala contributiva del Seguro de Salud para trabajadores independientes",
    norma: "Acta 8999",
    articulo: "Artículo 1",
    path: [],
    part: 0,
    content:
      "El trabajador independiente cuyo ingreso de referencia sea inferior a " +
      "dos salarios mínimos aportará un 6,71 % de dicho ingreso, y el Estado " +
      "completará la contribución conjunta. La cuota se paga mensualmente.",
    source: { url: "https://www.ccss.sa.cr/escala-salud" },
    fetchedAt: "2026-02-01T10:00:00Z",
    score: 0.03,
    vectorRank: 2,
    lexicalRank: 2,
  },
];

/**
 * The case as it would be written in `dataset.jsonl`: the rate is a `literal`
 * (deterministic, no judge), the base is prose (judged).
 */
const CASE: EvalCase = {
  id: "ccss-cuanto-pago-fixture",
  seed: "held-out",
  question: QUESTION,
  expected: [{ docKey: "ccss-escala-salud" }],
  blocking: true,
  tier: 1,
  heldOut: true,
  family: "T1-F",
  requiredClaims: [
    {
      claim: "la cuota del afiliado es 6,71 % del ingreso",
      literal: ["6,71 %", "6,71%"],
    },
    {
      claim:
        "la cuota se calcula sobre el ingreso de referencia declarado, no sobre el ingreso bruto",
    },
  ],
};

/** Supported by both fragments, and it never says what the cuota is. */
const RATE_LESS_ANSWER =
  "Sí, como trabajador independiente el aseguramiento ante la CCSS es " +
  "obligatorio: debe afiliarse y cotizar desde que realiza actividad por " +
  "cuenta propia [1]. La cuota se paga mensualmente [2]. El monto depende de " +
  "su situación, así que conviene confirmarlo con la Caja.";

/** The same answer with the two required claims in it. */
const COMPLETE_ANSWER =
  "Como trabajador independiente el aseguramiento es obligatorio [1]. La " +
  "cuota del Seguro de Salud es 6,71 % de su ingreso de referencia si este es " +
  "menor a dos salarios mínimos, y se paga mensualmente [2]. Ese porcentaje " +
  "se aplica sobre el ingreso de referencia que usted declara ante la Caja, " +
  "no sobre su ingreso bruto [1].";

describeEval("adequacy vs groundedness on a rate-less answer (#130)", () => {
  const requirements = judgedRequirements(CASE);

  it("the rate-less answer is grounded — every claim it makes is supported", async () => {
    const judged = await judgeAnswer(QUESTION, CHUNKS, RATE_LESS_ANSWER);
    expect(judged.verdict, judged.reason).toBe("pass");
  }, 180_000);

  it("…and inadequate: the figure is absent and the base is never stated", async () => {
    // Deterministic half — no judge is asked whether "6,71 %" is in a string.
    const literals = literalFailures(
      checkLiterals(RATE_LESS_ANSWER, CASE.requiredClaims ?? []),
    );
    expect(literals).toEqual([
      "la cuota del afiliado es 6,71 % del ingreso (6,71 % | 6,71%: absent)",
    ]);

    const judged = await judgeAdequacy(
      QUESTION,
      requirements,
      RATE_LESS_ANSWER,
    );
    expect(judged.verdict, `missing: ${judged.missing.join("; ")}`).toBe(
      "fail",
    );
    expect(judged.missing).toEqual(requirements.map((r) => r.text));
  }, 180_000);

  it("the complete answer passes both gates (the positive control)", async () => {
    const grounded = await judgeAnswer(QUESTION, CHUNKS, COMPLETE_ANSWER);
    expect(grounded.verdict, grounded.reason).toBe("pass");

    expect(
      literalFailures(
        checkLiterals(COMPLETE_ANSWER, CASE.requiredClaims ?? []),
      ),
    ).toEqual([]);

    const judged = await judgeAdequacy(QUESTION, requirements, COMPLETE_ANSWER);
    expect(judged.verdict, `missing: ${judged.missing.join("; ")}`).toBe(
      "pass",
    );
  }, 180_000);
});
