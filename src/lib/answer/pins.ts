/**
 * Everything appended to the answer set after the cut, in one place: the
 * route, the eval lanes and the probes call this and nothing else, so they
 * cannot drift apart on what the model reads.
 *
 * Three appends, in this order. The first two are judged against the set the
 * rerank cut and never against each other's output, so neither can chain
 * into the other:
 *
 * 1. In-document cross-references (#508, ADR 0024): an artículo the set
 *    names, «la tarifa referida en el artículo 10», at most one.
 * 2. Derived-figure inputs (#287, ADR 0018): the sibling of a figure input
 *    that survived the cut.
 * 3. A source the question names (#559, `NAMED_SOURCES` in steps.ts): «qué
 *    código CABYS uso» brings `cabys-dev`'s best pooled chunk, at most one,
 *    when the set holds none of that document. It is read from the question
 *    retrieval and the rerank ran on (the condensed one), and from the pool,
 *    so it costs no lookup; a source the pool lacks is not appended.
 *
 * All three append and never replace, so the citation markers the cut's chunks
 * carry are the ones they would carry without them, and each appended chunk
 * is numbered and cited like any other.
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
import { namedSources } from "./steps";

export interface PinOptions extends CrossReferenceOptions {
  figures?: readonly DerivedFigure[];
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
  const referenced = await crossReferencedChunks(answerSet, options);
  const derived = pinDerivedFigureInputs(
    answerSet,
    pool,
    options.figures ?? DERIVED_FIGURES,
  ).filter((chunk) => !answerSet.includes(chunk));
  const pinned = [...answerSet];
  for (const chunk of [...referenced, ...derived]) {
    // A reference can name a figure's input: it goes in once.
    if (!pinned.some((held) => held.chunkId === chunk.chunkId)) {
      pinned.push(chunk);
    }
  }
  for (const chunk of namedSourceChunks(question, pinned, pool)) {
    pinned.push(chunk);
  }
  return pinned;
}
