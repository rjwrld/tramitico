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
}

const MARKER = /\[(\d+)\]/g;
/** A bracket run at the end of the buffer that a later delta could complete. */
const PARTIAL_MARKER_TAIL = /\[\d*$/;

export function createCitationTracker(
  chunks: readonly RetrievedChunk[],
): CitationTracker {
  const byIndex = chunkCitations(chunks);
  const seen = new Set<string>();
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
  };
}
