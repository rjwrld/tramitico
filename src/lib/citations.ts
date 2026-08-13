/**
 * The `Citation` shape and its runtime guards (SPEC §5) — split out of
 * `retrieval.ts` so client components can validate persisted citations
 * (issue #94) without pulling retrieval's server-only value imports
 * (`serviceClient`, `createEmbedder`) into the browser bundle. `retrieval.ts`
 * re-exports everything here, so server-side callers are unaffected.
 */

/** What an answer renders as a `Documento · Artículo` chip (SPEC §5). */
export interface Citation {
  docKey: string;
  docTitle: string;
  norma: string | null;
  articulo: string | null;
  url: string | null;
  /**
   * ISO timestamp the corpus last fetched the document (#135), printed under
   * the stamp as "consultado el …". Optional, not nullable-required: rows
   * persisted before #135 carry no such key, and `isCitation` filters the
   * history view — a required field would blank every saved answer.
   */
  fetchedAt?: string | null;
}

/**
 * Runtime guard for one persisted `citations` element (issue #61):
 * `saveQuestion` writes `Citation[]` through a `Json` cast (persist.ts), so
 * nothing statically checks that a row read back from `questions.citations`
 * still has this shape. `docKey`/`docTitle` are always strings; `norma`,
 * `articulo`, `url` are nullable per `Citation` — a chunk can lack a norma
 * label, an artículo, or a resolvable citation URL. `fetchedAt` (#135) is
 * checked only when present: it postdates the rows already in `questions`,
 * and a row saved without it is still a valid citation — it simply has no
 * date to print under its stamp.
 */
export function isCitation(value: unknown): value is Citation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.docKey === "string" &&
    typeof v.docTitle === "string" &&
    (typeof v.norma === "string" || v.norma === null) &&
    (typeof v.articulo === "string" || v.articulo === null) &&
    (typeof v.url === "string" || v.url === null) &&
    (typeof v.fetchedAt === "string" ||
      v.fetchedAt === null ||
      v.fetchedAt === undefined)
  );
}

/**
 * Parses a persisted `citations` column (or any `Json`) back into
 * `Citation[]`, throwing on the first element that does not match — the
 * same check the history UI could adopt instead of trusting the `Json` cast
 * in `persist.ts` blind.
 */
export function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    throw new Error(`parseCitations: expected an array, got ${typeof value}`);
  }
  return value.map((entry, index) => {
    if (!isCitation(entry)) {
      throw new Error(
        `parseCitations: element ${index} is not a Citation: ${JSON.stringify(entry)}`,
      );
    }
    return entry;
  });
}
