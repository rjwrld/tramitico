/**
 * The ask stream contract (issue #21 owns it; #22's chat UI consumes it).
 * One data part: `data-citations`, the citations used so far — deduped, in
 * order of first use — re-written under a stable id as each new sello
 * applies, so the UI can render them progressively via reconciliation.
 */
import type { UIMessage } from "ai";
import type { Citation } from "../retrieval";

export interface AskDataParts {
  citations: Citation[];
  [key: string]: unknown;
}

export type AskUIMessage = UIMessage<never, AskDataParts>;

/** Stable data-part id — every write updates the same part. */
export const CITATIONS_PART_ID = "citations";
