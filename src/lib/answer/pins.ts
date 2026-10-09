/**
 * Everything appended to the answer set after the cut, in one place: the
 * route, the eval lanes and the probes call this and nothing else, so they
 * cannot drift apart on what the model reads.
 *
 * Four appends, in this order. The first three are judged against the set the
 * rerank cut and never against each other's output, so none can chain into
 * another:
 *
 * 1. In-document cross-references (#508, ADR 0024): an artículo the set
 *    names, «la tarifa referida en el artículo 10», at most one.
 * 2. Derived-figure inputs (#287, ADR 0018): the sibling of a figure input
 *    that survived the cut.
 * 3. The salario base in force (#579, `salario-base.ts`): a multa the set
 *    states in salarios base brings the year's circular, at most one.
 * 4. A source the question names (#559, `NAMED_SOURCES` in steps.ts): «qué
 *    código CABYS uso» brings `cabys-dev`'s best pooled chunk, at most one,
 *    when the set holds none of that document. It is read from the question
 *    retrieval and the rerank ran on (the condensed one), and from the pool,
 *    so it costs no lookup; a source the pool lacks is not appended.
 *
 * All four append and never replace, so the citation markers the cut's chunks
 * carry are the ones they would carry without them, and each appended chunk
 * is numbered and cited like any other.
 *
 * Which append brought each chunk is told to `onPins`, for the transcript:
 * #579's cause stayed «likely» because a row could not say.
 */
import { modeKnob } from "../knobs";
import type { RetrievedChunk } from "../retrieval";
import {
  crossReferencedChunks,
  type CrossReferenceOptions,
} from "./cross-references";
import {
  DERIVED_FIGURES,
  pinDerivedFigureInputs,
  type DerivedFigure,
} from "./derived";
import { salarioBaseChunks, type SalarioBaseOptions } from "./salario-base";
import { namedSources } from "./steps";

/**
 * What put a chunk past the cut: a step pick (`answerSetFromOrder`, #561),
 * or one of the four appends here.
 */
export type PinName =
  "step" | "crossReference" | "derivedInput" | "salarioBase" | "namedSource";

export interface PinOptions extends CrossReferenceOptions, SalarioBaseOptions {
  figures?: readonly DerivedFigure[];
  /** Told, once, which append brought each chunk it added, by chunk id. */
  onPins?: (pins: ReadonlyMap<string, PinName>) => void;
}

/** At most this many chunks are appended for the sources a question names. */
export const NAMED_SOURCE_CAP = 1;

const namedSourceKnob = modeKnob("PIN_NAMED_SOURCES", ["on", "off"], "on");

/**
 * Whether a source the question names is appended. Unset and empty mean on,
 * like every mode knob (knobs.ts); `off` is the baseline a probe compares.
 */
export function namedSourcesEnabled(): boolean {
  return namedSourceKnob() === "on";
}

/**
 * The best pooled chunk of each source the question names whose document
 * the set does not already carry, at most `NAMED_SOURCE_CAP`.
 */
function namedSourceChunks(
  question: string,
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
): RetrievedChunk[] {
  if (!namedSourcesEnabled()) return [];
  const held = new Set(answerSet.map((chunk) => chunk.docKey));
  return namedSources(question)
    .filter((docKey) => !held.has(docKey))
    .flatMap((docKey) => pool.find((chunk) => chunk.docKey === docKey) ?? [])
    .slice(0, NAMED_SOURCE_CAP);
}

/**
 * `question` is the one retrieval and the rerank read: the condensed
 * standalone question on a follow-up, the reader's own words otherwise.
 */
export async function pinAnswerSet(
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
  question: string,
  options: PinOptions = {},
): Promise<RetrievedChunk[]> {
  // The two lookups are independent reads of the cut: one wait, not two.
  const [referenced, salarioBase] = await Promise.all([
    crossReferencedChunks(answerSet, options),
    salarioBaseChunks(answerSet, pool, options),
  ]);
  const derived = pinDerivedFigureInputs(
    answerSet,
    pool,
    options.figures ?? DERIVED_FIGURES,
  ).filter((chunk) => !answerSet.includes(chunk));
  const pinned = [...answerSet];
  const pins = new Map<string, PinName>();
  const append = (chunks: readonly RetrievedChunk[], pin: PinName) => {
    for (const chunk of chunks) {
      // A reference can name a figure's input: it goes in once.
      if (pinned.some((held) => held.chunkId === chunk.chunkId)) continue;
      pinned.push(chunk);
      pins.set(chunk.chunkId, pin);
    }
  };
  append(referenced, "crossReference");
  append(derived, "derivedInput");
  append(salarioBase, "salarioBase");
  append(namedSourceChunks(question, pinned, pool), "namedSource");
  options.onPins?.(pins);
  return pinned;
}
