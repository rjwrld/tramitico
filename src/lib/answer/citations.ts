/**
 * Citation tracking for streamed answers (issue #21). The model cites claims
 * with [n] markers referring to the 1-based chunk numbering produced by
 * `formatChunks`. This module watches the streamed text for those markers and
 * yields the corresponding citations deduped, in order of first use — that is
 * what the route publishes as the `data-citations` part so the UI can render
 * sellos as they apply.
 */
import {
  citationIdentity,
  toCitation,
  type Citation,
  type RetrievedChunk,
} from "../retrieval";

/** Citation for each chunk, index-aligned with the [n] numbering (n = i + 1). */
export function chunkCitations(chunks: readonly RetrievedChunk[]): Citation[] {
  return chunks.map(toCitation);
}

export interface CitationTracker {
  /**
   * Feed one streamed text delta. Returns the citations that became used for
   * the first time within this delta, in order of appearance.
   */
  append(delta: string): Citation[];
  /** All citations used so far, deduped, in order of first use. */
  used(): Citation[];
  /**
   * Chunk index → seal ordinal for the citations used so far, in the shape
   * `renumberCitationMarkers` consumes. Every chunk that shares an artículo
   * with a used one resolves too, so a later [n] pointing at the sibling
   * chunk still lands on the seal already on screen.
   */
  ordinals(): number[];
}

const MARKER = /\[(\d+)\]/g;
/** A bracket run at the end of the buffer that a later delta could complete. */
const PARTIAL_MARKER_TAIL = /\[\d*$/;
/**
 * The same markers as `MARKER`, matched as a run with the horizontal space
 * that precedes them — the shape needed to delete them from prose ("…exentos
 * [6][8]." → "…exentos."). Only bare integers, so legal-text brackets
 * ("[nota]", "[12x]") survive.
 */
const MARKER_RUN = /[ \t]*(?:\[\d+\])+/g;
/** `PARTIAL_MARKER_TAIL` plus the space before it — the render-side form. */
const PARTIAL_MARKER_RUN_TAIL = /[ \t]*\[\d*$/;

/**
 * Chunk-index → seal ordinal, indexed by `n - 1`; `0` where no seal applies.
 *
 * The [n] the model writes counts *chunks*; a seal counts *sources*, and the
 * two never line up — the rerank pool routinely hands back several chunks of
 * one artículo, which collapse into a single seal. This map is the only place
 * that knows which is which, so it travels with the answer (contract.ts) and
 * is stamped into the text before persistence.
 */
export type MarkerOrdinals = readonly number[];

/**
 * The map for an answer whose markers already *are* seal ordinals — a
 * persisted one (`saveQuestion` renumbers before writing). `[k]` resolves to
 * seal k for k ≤ count; anything above has no seal and drops out, which is
 * what keeps a legacy or malformed row from rendering an orphan superscript.
 */
export function identityOrdinals(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * The [n] markers rewritten as `[k]` seal ordinals (issues #75, #133).
 *
 * The wire numbering never reaches a reader: it is either rewritten here into
 * the numbering the sello row uses — which is what the superscript references
 * render from — or, where no seal backs it, deleted along with the space
 * before it, exactly as #75's strip did. So an answer coming out of here has
 * markers only for claims a reader can actually follow to a source.
 *
 * `streaming` additionally hides a bracket run still being typed (`… 13% [1`),
 * which would otherwise flash as literal text between two deltas.
 */
export function renumberCitationMarkers(
  text: string,
  ordinals: MarkerOrdinals,
  { streaming = false }: { streaming?: boolean } = {},
): string {
  const renumbered = text.replace(MARKER_RUN, (run) => {
    const kept: number[] = [];
    for (const match of run.matchAll(MARKER)) {
      const ordinal = ordinals[Number(match[1]) - 1] ?? 0;
      // Two chunks of one artículo share a seal: cite both in one run and the
      // reader would see the same superscript twice.
      if (ordinal > 0 && !kept.includes(ordinal)) kept.push(ordinal);
    }
    return kept.map((ordinal) => `[${ordinal}]`).join("");
  });
  return streaming
    ? renumbered.replace(PARTIAL_MARKER_RUN_TAIL, "")
    : renumbered;
}

export function createCitationTracker(
  chunks: readonly RetrievedChunk[],
): CitationTracker {
  const byIndex = chunkCitations(chunks);
  const seen = new Set<string>();
  const ordinalByIdentity = new Map<string, number>();
  const usedList: Citation[] = [];
  let buffer = "";

  return {
    append(delta: string): Citation[] {
      buffer += delta;
      const added: Citation[] = [];
      let lastConsumed = 0;
      for (const match of buffer.matchAll(MARKER)) {
        lastConsumed = match.index + match[0].length;
        const citation = byIndex[Number(match[1]) - 1];
        if (!citation) continue;
        const key = citationIdentity(citation);
        if (seen.has(key)) continue;
        seen.add(key);
        usedList.push(citation);
        ordinalByIdentity.set(key, usedList.length);
        added.push(citation);
      }
      // Keep only what could still become a marker: text after the last full
      // match that ends in an unclosed "[123" run.
      const rest = buffer.slice(lastConsumed);
      const tail = rest.match(PARTIAL_MARKER_TAIL);
      buffer = tail ? tail[0] : "";
      return added;
    },
    used(): Citation[] {
      return [...usedList];
    },
    ordinals(): number[] {
      return byIndex.map(
        (citation) => ordinalByIdentity.get(citationIdentity(citation)) ?? 0,
      );
    },
  };
}
