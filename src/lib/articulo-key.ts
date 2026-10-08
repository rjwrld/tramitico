/**
 * How an artículo label is compared, shared by #508's cross-reference
 * resolver and the corpus index's repeated-label guard (#530): the guard is
 * only worth having if it calls two labels the same exactly when the
 * resolver would. Pure, so `scripts/ingest.ts` can reach it through the
 * corpus index without pulling in the answer pipeline.
 */

/** Lowercase, unaccented, single-spaced: how titles and markers compare. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * An artículo label as the chunker wrote it → the number a reference names:
 * «Artículo 10» and «ARTICULO 10» → «10», «Artículo 11 bis» → «11 BIS».
 * Null for a label that is not one numbered artículo — a transitorio, a
 * preámbulo, an acta's «Artículo 4°, sesión 9570», an FAQ question.
 */
export function articuloKey(label: string | null | undefined): string | null {
  if (!label) return null;
  const m = fold(label.trim()).match(
    /^articulo (\d+) ?(?:\.?[°º])?(?: (bis|ter|quater|quinquies))?$/,
  );
  if (!m) return null;
  return m[2] ? `${Number(m[1])} ${m[2].toUpperCase()}` : String(Number(m[1]));
}
