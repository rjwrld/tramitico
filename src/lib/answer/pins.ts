/**
 * Everything appended to the answer set after the cut, in one place: the
 * route, the eval lanes and the probes call this and nothing else, so they
 * cannot drift apart on what the model reads.
 *
 * Two appends, in this order, both judged against the set the rerank cut and
 * never against each other's output, so neither can chain into the other:
 *
 * 1. In-document cross-references (#508, ADR 0024): an artículo the set
 *    names, «la tarifa referida en el artículo 10», at most two.
 * 2. Derived-figure inputs (#287, ADR 0018): the sibling of a figure input
 *    that survived the cut.
 *
 * Both append and never replace, so the citation markers the cut's chunks
 * carry are the ones they would carry without them, and each appended chunk
 * is numbered and cited like any other.
 */
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

export interface PinOptions extends CrossReferenceOptions {
  figures?: readonly DerivedFigure[];
}

export async function pinAnswerSet(
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
  options: PinOptions = {},
): Promise<RetrievedChunk[]> {
  const referenced = await crossReferencedChunks(answerSet, pool, options);
  const derived = pinDerivedFigureInputs(
    answerSet,
    pool,
    options.figures ?? DERIVED_FIGURES,
  ).slice(answerSet.length);
  const pinned = [...answerSet];
  for (const chunk of [...referenced, ...derived]) {
    // A reference can name a figure's input: it goes in once.
    if (!pinned.some((held) => held.chunkId === chunk.chunkId)) {
      pinned.push(chunk);
    }
  }
  return pinned;
}
