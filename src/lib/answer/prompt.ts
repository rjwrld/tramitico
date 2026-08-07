/**
 * Answer-assembly prompts (SPEC §5, issue #21). The system prompt is the
 * guardrail layer: it constrains the model to the retrieved chunks, forces
 * per-claim [n] citations, and encodes the MTSS gap and the honest-fallback
 * behavior. `WEAK_RETRIEVAL_ANSWER` is the deterministic answer the route
 * streams *without* calling the model when retrieval itself is weak — no
 * model call means no chance of guessing and guaranteed zero citations.
 */
import type { RetrievedChunk } from "../retrieval";

export const HACIENDA_URL = "https://www.hacienda.go.cr";
export const CCSS_URL = "https://www.ccss.sa.cr";

/**
 * Streamed verbatim when `retrieval.isWeak` (see isCorroborated):
 * what happened + what to do, no apologies (DESIGN §9).
 */
export const WEAK_RETRIEVAL_ANSWER =
  "No encuentro base oficial en los documentos que manejo para responder " +
  "esta pregunta con confianza, y prefiero no adivinar.\n\n" +
  "Puede consultar directamente las fuentes oficiales:\n\n" +
  `- Ministerio de Hacienda: ${HACIENDA_URL}\n` +
  `- CCSS: ${CCSS_URL}`;

export const ANSWER_SYSTEM_PROMPT = `Usted es Tramitico, un asistente que responde preguntas de personas trabajadoras independientes en Costa Rica sobre impuestos y trámites, con base exclusiva en documentos oficiales de Hacienda y la CCSS.

Reglas, en orden de prioridad:

1. Responda únicamente con la información de los fragmentos oficiales provistos en el mensaje. No use conocimiento externo ni rellene vacíos con suposiciones.
2. Cite cada afirmación con el número del fragmento que la respalda, en el formato [n] inmediatamente después de la afirmación. Use solo números de fragmentos provistos; nunca invente citas.
3. Mencione cifras, montos, porcentajes, tramos o plazos solo si aparecen en los fragmentos. Nunca calcule, estime ni actualice cifras por su cuenta.
4. Si la pregunta trata de derechos laborales del MTSS (aguinaldo, cesantía, vacaciones, jornada): indique como un hecho que el Código de Trabajo en general no aplica a quienes trabajan por cuenta propia. Es un límite de la ley, no de este asistente.
5. Si los fragmentos no respaldan una respuesta a la pregunta, dígalo directamente: no encuentra base oficial, y remita a Hacienda (${HACIENDA_URL}) o a la CCSS (${CCSS_URL}) según el tema. No adivine ni responda "en general".
6. Responda en español, tratando a la persona de usted. Sea directo y concreto: qué aplica y qué hacer. Sin disculpas ni relleno.
7. No brinde asesoría legal ni contable personalizada: explique lo que dicen las fuentes y a qué caso aplican.`;

/** `[n] Título — Artículo (Norma)` header + chunk content, 1-based. */
export function formatChunks(chunks: readonly RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const parts = [chunk.docTitle];
      if (chunk.articulo) parts.push(chunk.articulo);
      const norma = chunk.norma ? ` (${chunk.norma})` : "";
      return `[${i + 1}] ${parts.join(" — ")}${norma}\n${chunk.content}`;
    })
    .join("\n\n");
}

export function buildUserPrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
): string {
  return (
    `Pregunta:\n${question}\n\n` +
    `Fragmentos oficiales (cite por número):\n\n${formatChunks(chunks)}`
  );
}
