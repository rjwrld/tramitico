/**
 * The one definition of "does this chunk satisfy an acceptable target?",
 * shared by the two bench scripts (`bench-embeddings.ts`,
 * `bench-canary-hybrid.ts`).
 *
 * It lives here because the two scripts each carried their own copy, and that
 * is what caused #218: one exact-matched `articulo`, the other prefix-matched,
 * so the canary bench reported false TARGET hits. One predicate, one place to
 * change it (#228).
 */

/**
 * An acceptable target. `articulo` present = artículo-level match; absent =
 * any chunk of the doc counts.
 */
export interface Target {
  docKey: string;
  articulo?: string;
}

/** The chunk shape the predicate needs — both scripts' rows are supersets. */
export interface TargetChunk {
  doc_key: string;
  articulo: string | null;
}

export function matchesTarget(chunk: TargetChunk, targets: Target[]): boolean {
  // Exact articulo match — sub-split parts share the label, and a prefix test
  // would let "Artículo 8" claim "Artículo 80" or "Artículo 81 bis" (#218).
  return targets.some(
    (t) =>
      chunk.doc_key === t.docKey &&
      (!t.articulo || chunk.articulo === t.articulo),
  );
}
