/**
 * Consolidated-vs-amending case (issue #182), the mirror of
 * `conflicting-sources.ts`.
 *
 * Rule 4 tells the model that fragments differing on a figure must be reported
 * as a live discrepancy. Ingesting a consolidated law beside the law that
 * reformed it guarantees pairs that differ on figures and are *not* in
 * conflict — the same norma at two moments, where the consolidated text is
 * simply the current one. Reporting those as a discrepancy is an unsupported
 * claim, and the groundedness judge scores it as one: it is what
 * `iva-tarifas-reducidas` failed 3/3 on in #157's gate re-run.
 *
 * Unlike the conflicting-sources fixture, these fragments are **real**: the
 * ingested `ley-iva` and `ley-9635` Artículo 11 chunks, trimmed to the incisos
 * that differ (2.b's education exception, and the 0,5% bracket that exists
 * only in the consolidated text). Hand-writing them would have let the case
 * drift from the pair that actually fails.
 *
 * The judge is a third one. Groundedness asks whether every claim is
 * supported; the conflict judge asks whether a real discrepancy was surfaced.
 * This one asks the inverse of the conflict judge — was a discrepancy
 * *invented* between two moments of one norma? — so that a rule 4 amendment is
 * held from both sides at once (#182's validation requirement).
 */
import { generateText } from "ai";
import type { RetrievedChunk } from "../retrieval";
import { formatChunks } from "../answer/prompt";
import {
  getJudgeModel,
  JUDGE_TEMPERATURE,
  parseJudgeVerdict,
  type JudgeOnce,
} from "./groundedness";

/** `iva-tarifas-reducidas` from `eval/dataset.jsonl`, verbatim. */
export const AMENDING_QUESTION =
  "¿Qué tarifas reducidas de IVA existen y a qué bienes o servicios aplican?";

/**
 * The consolidated text and the reform that wrote it, on the same artículo.
 * Trimmed from the ingested chunks; the `[Title — path — Artículo]` prefix is
 * the ingestion-time header the real chunk content carries.
 */
export const AMENDING_CHUNKS: RetrievedChunk[] = [
  {
    chunkId: "amending-consolidated",
    docKey: "ley-iva",
    docTitle: "Ley del Impuesto sobre el Valor Agregado (texto consolidado)",
    norma: "Ley 6826",
    articulo: "Artículo 11",
    path: ["CAPÍTULO III EXENCIONES Y TASA DEL IMPUESTO"],
    part: 0,
    content:
      "[Ley del Impuesto sobre el Valor Agregado (texto consolidado) — " +
      "CAPÍTULO III EXENCIONES Y TASA DEL IMPUESTO — Artículo 11] " +
      "Artículo 11- Tarifa reducida. Se establecen las siguientes tarifas " +
      "reducidas: 1. Del cuatro por ciento (4%) para los siguientes bienes o " +
      "servicios: a. La compra de boletos o pasajes aéreos, cuyo origen o " +
      "destino sea el territorio nacional, para cualquier clase de viaje. " +
      "b. Los servicios de salud privados prestados por centros de salud " +
      "autorizados, o profesionales en ciencias de la salud autorizados. " +
      "2. Del dos por ciento (2%) para los siguientes bienes o servicios: " +
      "a. Los medicamentos, las materias primas, los insumos, la maquinaria, " +
      "el equipo y los reactivos necesarios para su producción, autorizados " +
      "por el Ministerio de Hacienda. b. Los servicios de educación privada, " +
      "con excepción de los exentos según el inciso 31 del artículo 8 de la " +
      "Ley 6826, Ley de Impuesto al Valor Agregado, de 8 de noviembre de " +
      "1982. (Así reformado el inciso anterior por el artículo único de la " +
      "Ley Exención para la aplicación del Impuesto sobre el Valor Agregado " +
      "(IVA) a la Educación Superior Privada, N° 10479 del 14 de mayo de " +
      "2024) c. Las primas de seguros personales. 3. Del uno por ciento (1%) " +
      "para los siguientes bienes o servicios: a. Las ventas, así como las " +
      "importaciones o internaciones, de los bienes agropecuarios incluidos " +
      "en la canasta básica. b. Las ventas, así como las importaciones o " +
      "internaciones de los artículos definidos en la canasta básica. " +
      "4. Del cero coma cinco por ciento (0,5%) para los siguientes bienes y " +
      "servicios: a. La venta de productos agropecuarios o agroindustriales " +
      "orgánicos que se encuentren registrados y certificados ante la " +
      "entidad correspondiente. (Así adicionado el inciso 4) anterior por el " +
      "artículo 1° de la Ley para proteger el desarrollo, la promoción y el " +
      "fomento de la actividad agropecuaria orgánica, N° 10256 del 24 de " +
      "agosto de 2022)",
    source: {},
    fetchedAt: "2026-08-06T15:04:05Z",
    score: 0.032,
    vectorRank: 1,
    lexicalRank: 1,
  },
  {
    chunkId: "amending-reform",
    docKey: "ley-9635",
    docTitle: "Ley de Fortalecimiento de las Finanzas Públicas",
    norma: "Ley 9635",
    articulo: "Artículo 11",
    path: ["TÍTULO I", "CAPÍTULO III"],
    part: 0,
    content:
      "[Ley de Fortalecimiento de las Finanzas Públicas — TÍTULO I — " +
      "CAPÍTULO III — Artículo 11] " +
      "Artículo 11- Tarifa reducida. Se establecen las siguientes tarifas " +
      "reducidas: 1. Del cuatro por ciento (4%) para los siguientes bienes o " +
      "servicios: a. La compra de boletos o pasajes aéreos, cuyo origen o " +
      "destino sea el territorio nacional, para cualquier clase de viaje. " +
      "b. Los servicios de salud privados prestados por centros de salud " +
      "autorizados, o profesionales en ciencias de la salud autorizados. " +
      "2. Del dos por ciento (2%) para los siguientes bienes o servicios: " +
      "a. Los medicamentos, las materias primas, los insumos, la maquinaria, " +
      "el equipo y los reactivos necesarios para su producción, autorizados " +
      "por el Ministerio de Hacienda. b. Los servicios de educación privada. " +
      "c. Las primas de seguros personales. 3. Del uno por ciento (1%) para " +
      "los siguientes bienes o servicios: a. Las ventas, así como las " +
      "importaciones o internaciones, de los bienes agropecuarios incluidos " +
      "en la canasta básica. b. Las ventas, así como las importaciones o " +
      "internaciones, de los artículos definidos en la canasta básica.",
    source: {},
    fetchedAt: "2026-08-06T15:04:05Z",
    score: 0.031,
    vectorRank: 2,
    lexicalRank: 2,
  },
];

/**
 * The rate the reform never had and the consolidated text does — the figure
 * rule 4 used to read as a contradiction between the two fragments.
 */
export const AMENDING_ONLY_IN_CONSOLIDATED = "0,5%";

export const AMENDING_JUDGE_SYSTEM_PROMPT = `You are an adversarial judge for a Costa Rican tax/trámite assistant. You are given a user question, two numbered official fragments, and the assistant's answer (in Spanish).

The two fragments are the SAME article of the SAME body of law at two moments: fragment [1] is the consolidated (current) text, and fragment [2] is the reform law that wrote it. They differ on some figures and wording because the consolidated text has since been amended. They are NOT two sources in conflict, and nothing in them says the current rates are disputed.

Decide only one thing: does the answer invent a disagreement between the sources?

It fails if the answer does any of these:
- Says or implies that the official sources disagree, differ, are inconsistent, or are not in agreement about the rates.
- Tells the reader to verify with Hacienda or the CCSS which figure is currently in force because the sources conflict.
- Presents the superseded wording as an alternative rate that might also apply today.

It passes if the answer simply states the current reduced rates, without asserting a discrepancy. Noting that a rate was added or reformed by a later law IS allowed when the fragments say so; describing the older wording as a past state of the same law is also allowed.

Do not judge style, completeness, citations, or whether the answer is otherwise helpful. Only the invented-discrepancy question.

Respond with only a JSON object, no other text:
{"verdict": "pass" | "fail", "reason": "<one short sentence>"}`;

/** Question + the two moments of the one norma + the answer under judgement. */
export function buildAmendingJudgePrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
  answer: string,
): string {
  return (
    `Pregunta:\n${question}\n\n` +
    `Fragmentos oficiales provistos ([1] texto consolidado vigente, [2] la ley que lo reformó — la misma norma en dos momentos):\n\n${formatChunks(chunks)}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

/** One amending-law judge call, shaped as a `JudgeOnce` for `judgeAnswer`. */
export const amendingJudgeOnce: JudgeOnce = async (
  question,
  chunks,
  answer,
) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: AMENDING_JUDGE_SYSTEM_PROMPT,
    prompt: buildAmendingJudgePrompt(question, chunks, answer),
    temperature: JUDGE_TEMPERATURE,
  });
  return parseJudgeVerdict(text);
};
