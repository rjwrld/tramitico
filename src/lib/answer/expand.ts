/**
 * Query expansion — asking the corpus's question as well as the reader's
 * (issue #286).
 *
 * The 2026 baseline (#267) missed six cases whose expected artículo never
 * entered the fused pool. #286 measured the cause on all six and it is the
 * same one every time: **register**, not chunking and not the index. Nineteen
 * of the twenty expected chunks retrieve themselves at vector rank 1, so the
 * embeddings are healthy; all six questions already take the lexical
 * OR-fallback branch, so the strict/loose switch is not holding anything
 * back. What fails is that a reader writes «me inscribí un año tarde» and the
 * artículo that answers it says «omisión de la declaración de inscripción».
 * The Spanish snowball stemmer cannot bridge those two — `inscrib` and
 * `inscripcion` do not even share a prefix — and the vector leg puts that
 * artículo at rank 96 of 871.
 *
 * So the pipeline asks twice. This module rewrites the question into the
 * register the documents are written in, and `retrieve` runs the same hybrid
 * pair over the rewrite: its embedding against the vector leg, its text
 * against the lexical leg, fused into the same RRF sum. On the six, the best
 * expected chunk moves from ranks 96/122/53/51/38/23 in the vector leg to
 * 1/1/3/10/1/3, and from outside the pool of 40 to pool ranks 16/12/6/35/39/9.
 *
 * It is modelled on `condense.ts` — same seam, same small model, same three
 * properties, and for the same reasons:
 *
 * 1. **It can never block an ask.** Every failure — outage, timeout, an empty
 *    or overlong rewrite, a refusal — returns `null`, and `retrieve` then
 *    runs the two legs it always ran. A degraded search is what the product
 *    did last week; a failed ask is a regression. Nothing here throws at its
 *    caller.
 * 2. **Its cost is flat and small.** One bounded call on the smallest model,
 *    output capped, no corpus and no history in the prompt.
 * 3. **It only ever adds candidates.** The expansion is a *fourth and fifth*
 *    contribution to the fusion, never a replacement for the question's own
 *    legs, so nothing the literal question found leaves the candidate set. It
 *    does share the RRF sum, so a bad expansion can still push a good chunk
 *    down the fused order — bounded, not impossible, and measured at up to
 *    four ranks over the 61 single-turn cases.
 *
 * Unlike condensation this runs on every ask, including the first turn: a
 * single-turn question is exactly the case the six misses came from. That is
 * a change in what Anthropic receives, so `/privacidad` says so (#136).
 *
 * Nothing in this module logs a question or a rewrite: question text never
 * reaches a log (#136).
 */
import { generateText } from "ai";
import manifest from "../../../corpus/manifest.json";
import { getExpandModel, REWRITE_PROVIDER_OPTIONS } from "./model";
import { modeKnob } from "../knobs";
import { describeError, timeoutOrError } from "../log-redaction";

/**
 * How long an expansion may take before retrieval goes ahead without one.
 * Tighter than condensation's 4 s: a follow-up without its antecedent
 * retrieves against nothing, so condensation is worth waiting for, while a
 * missing expansion only costs the search its second register — and this call
 * sits in front of *every* ask, where the seconds are the reader's.
 */
export const EXPAND_TIMEOUT_MS = 3_000;

/**
 * Output cap. Two or three sentences of corpus vocabulary, not an answer.
 *
 * 300, up from 200 for Haiku 4.5, because Haiku 5.5's tokenizer spends about
 * 30% more tokens on the same text. The longest of the 164 distinct
 * expansions in the committed `eval/runs/` is 776 characters and none stopped
 * at the old cap; at the new rate that one alone would run past 200. 300
 * puts the cap at roughly `MAX_EXPANSION_LENGTH`'s worth of tokens, so the
 * character limit, not a truncated last sentence, is what turns away a
 * rambling rewrite.
 * Thinking is off (`REWRITE_PROVIDER_OPTIONS`), so none of it is spent there.
 */
export const EXPAND_MAX_OUTPUT_TOKENS = 300;

/** Longest expansion we will accept, in characters. */
export const MAX_EXPANSION_LENGTH = 1_000;

/**
 * The corpus, by title, as the expansion model sees it — read off
 * `corpus/manifest.json`, the same file `pnpm ingest` reads and
 * `corpus-summary.ts` and `derived.ts` already build from.
 *
 * This is the difference between a rewrite that guesses at official
 * vocabulary and one that uses the corpus's own. Asked «me inscribí un año
 * tarde» with no inventory, the model reads it as CCSS affiliation and the
 * expansion pulls the pool away from Hacienda; with the inventory in front of
 * it, «Código de Normas y Procedimientos Tributarios — intereses y hechos
 * ilícitos tributarios» is on the list and the rewrite names the sanción.
 *
 * A corpus change therefore changes this prompt, which is the same rule the
 * manifest already carries (CLAUDE.md): the titles are the contract.
 */
export const CORPUS_INVENTORY: string = manifest.documents
  .map((doc) => `- ${doc.title}${doc.norma ? ` (${doc.norma})` : ""}`)
  .join("\n");

export const EXPAND_SYSTEM_PROMPT = `Usted redacta el texto oficial que respondería una pregunta, para usarlo como sonda de búsqueda. Lo que usted escribe no lo lee ninguna persona: sirve únicamente para acercar la búsqueda al texto que sí existe, así que lo que importa es el vocabulario, no la exactitud.

La búsqueda corre sobre estos documentos y sobre ningún otro:

${CORPUS_INVENTORY}

Reglas:

1. Devuelva únicamente el texto, en una sola línea, sin comillas ni encabezados.
2. Piense, sin escribirlo, cuál o cuáles de esos documentos tratarían el asunto. Lo que devuelve son dos o tres oraciones redactadas como las redactaría ese documento: cómo titula la obligación, el trámite, la infracción, la sanción, el impuesto o el derecho de que se trata, y qué establece a grandes rasgos. No enumere documentos ni escriba «Documentos relevantes»: el texto que devuelve es normativo, no un índice.
3. Prefiera el sustantivo con que la norma titula el asunto al verbo con que lo dice la persona.
4. No invente cifras, porcentajes, plazos, fechas ni números de artículo: escriba «el porcentaje que fije la ley», «el plazo establecido». Un dato inventado desvía la búsqueda.
5. Manténgase en el asunto de la pregunta, pero no la desambigüe por su cuenta: si la persona no dice ante quién hizo o dejó de hacer algo, y el asunto lo tratarían tanto documentos tributarios como de la CCSS, escriba una oración por cada materia. Un trámite que existe en las dos —inscribirse, estar al día, dejar la actividad, deber cuotas o impuestos— es siempre uno de esos casos.
6. Español, en tercera persona, sin dirigirse a nadie.
7. Si la pregunta pide una cifra de otro año o futura —una tarifa, un porcentaje, un monto—, redacte la norma vigente que fija esa cifra, igual que si preguntara por la de hoy. Nunca escriba que el dato no existe, que la norma no lo prevé o que no hay proyecciones: esa negativa no está en ningún documento y aleja la búsqueda de la norma que sí fija la cifra.
8. La pregunta suele venir escrita como se habla: corta, con palabras coloquiales y sin nombrar la institución. Antes de redactar, tradúzcala a la situación concreta que regula una norma —qué se cobra, se paga, se declara o se deduce, a quién, desde cuándo y hasta cuándo— y redacte la norma de esa situación, no la de una palabra suelta de la pregunta.
9. No escriba un título seguido de una lista de asuntos vecinos —requisitos, procedimientos, otros impuestos, otros regímenes— que la pregunta no plantea: cada asunto de más aleja la búsqueda del que la persona pregunta. Las dos materias de la regla 5 no son asuntos de más.`;

export function buildExpandPrompt(question: string): string {
  return `Pregunta:\n${question}\n\nPregunta con términos oficiales:`;
}

/**
 * Why an expansion did not produce usable text. Same vocabulary as
 * `CondenseFailure`, and split for the same reason: `unusable` is a prompt or
 * model problem, `timeout`/`error` are availability ones.
 */
export type ExpandFailure = "timeout" | "error" | "unusable";

/**
 * Records one search that ran on the question alone. The prefix is
 * load-bearing: it is what a log-based counter matches on, so it is a
 * constant string with the variables tacked on as `key=value`. `error=` is
 * `describeError`'s token and nothing else.
 */
export function recordExpandFailure(
  reason: ExpandFailure,
  error?: unknown,
): void {
  console.warn(
    `ask: expansion failed — reason=${reason} ` +
      `error=${error === undefined ? "none" : describeError(error)}`,
  );
}

/**
 * Strips what a model puts around a one-line answer even when told not to.
 * Same treatment as `cleanCondensed`, and for the same reason: the result
 * goes into a `to_tsvector` and a `websearch_to_tsquery`, where a stray `"`
 * is not inert.
 */
export function cleanExpansion(raw: string): string {
  const firstLine = raw.trim().split("\n")[0]?.trim() ?? "";
  return firstLine
    .replace(/^["“'«]+/, "")
    .replace(/["”'»]+$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

const expandKnob = modeKnob("EXPAND", ["on", "off"], "on");

/**
 * Whether an ask expands at all — the one place that decides, so `retrieve`
 * does not carry a second copy of the policy.
 *
 * `EXPAND=off` opts out, mirroring `RERANK=off` (rerank.ts) and read the same
 * way (knobs.ts): unset and the "" CI interpolates for an unset `vars.EXPAND`
 * mean on, and any value but `on` or `off` means on and is logged. No
 * Anthropic key is the other way out, and it is what the integration, e2e and pgTAP lanes —
 * which run with no secrets — rely on to get the two-leg contract without a
 * failed call and its warning on every ask.
 */
export function expansionEnabled(): boolean {
  if (expandKnob() === "off") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ExpandOptions {
  /** Test seam; defaults to `EXPAND_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * The question in the corpus's own register, or `null` when there is no
 * usable rewrite — which every caller must treat as "search the question
 * alone", the behaviour retrieval had before #286.
 *
 * Returns rather than throws on every path, including a missing
 * `ANTHROPIC_API_KEY`: the integration lanes run with no secrets and must see
 * the two-leg contract, not a crash.
 */
export async function expandQuery(
  question: string,
  { timeoutMs = EXPAND_TIMEOUT_MS }: ExpandOptions = {},
): Promise<string | null> {
  const trimmed = question.trim();
  if (trimmed === "") return null;
  if (!expansionEnabled()) return null;

  let text: string;
  let refused: boolean;
  try {
    const result = await generateText({
      model: getExpandModel(),
      system: EXPAND_SYSTEM_PROMPT,
      prompt: buildExpandPrompt(trimmed),
      maxOutputTokens: EXPAND_MAX_OUTPUT_TOKENS,
      providerOptions: REWRITE_PROVIDER_OPTIONS,
      // The timeout alone, not the request's own signal — same reasoning as
      // condensation: a reader who presses stop is handled downstream, and
      // wiring their abort in here would log it as an expansion failure.
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    text = result.text;
    // A safety refusal is a completed call with no fallback model behind it;
    // same reading as condensation's.
    refused = result.finishReason === "content-filter";
  } catch (error) {
    recordExpandFailure(timeoutOrError(error), error);
    return null;
  }

  const expansion = cleanExpansion(text);
  if (refused || expansion === "" || expansion.length > MAX_EXPANSION_LENGTH) {
    recordExpandFailure("unusable");
    return null;
  }
  return expansion;
}
