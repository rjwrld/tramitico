/**
 * Typo runs (#500): a model slip in surface text, like the «ppagado» that
 * shipped in #490 item 3. Nothing else reads the answer's spelling — the
 * judges read meaning — so this is the one check that would see it.
 *
 * Counted in telemetry and reported in the lanes, never gated: a heuristic
 * with no dictionary behind it can be wrong both ways, and a typo is a polish
 * defect, not a trust one.
 *
 * A run is one of:
 *
 * - a tripled letter («deeeclarar»);
 * - a word that starts with a doubled letter («ppagado») — no Spanish word
 *   does, except with «ll»;
 * - a word that starts with a doubled syllable («dedeclarar»), minus the few
 *   real words built that way. Only at the start: inside a word the same
 *   shape is ordinary Spanish («dividido», «estatutos»), so «pagagado» is a
 *   miss this heuristic accepts.
 *
 * Roman numerals (inciso «iii», «XXX»), all-caps acronyms («CCSS») and
 * addresses («ccss.sa.cr», URLs) are not words for this purpose.
 */

/**
 * Real words that start with a doubled syllable. Found by running the rule
 * over every committed answer and every chunk the transcripts carry
 * («vivienda», «sesenta», «queques»), plus the common ones a tax answer can
 * plausibly write («dadas las condiciones», «raras veces»).
 */
const REDUPLICATED =
  /^(?:vivi|sese|dada|rara|caca|queque|coco|papa|mama|nene|bebe|cucu|chacha|titi)/;

const ADDRESS = /https?:\/\/\S+|www\.\S+|\S+@\S+|\S+\.(?:cr|com|org|net)\S*/giu;

/** The words of `text` that look like a typo run, in order, each once. */
export function typoRuns(text: string): string[] {
  const runs = new Set<string>();
  for (const match of text.replace(ADDRESS, " ").matchAll(/\p{L}+/gu)) {
    const word = match[0];
    const lower = word.toLowerCase();
    if (/^[ivxlcdm]+$/i.test(word)) continue;
    if (word.length > 1 && word === word.toUpperCase()) continue;
    if (
      /(\p{L})\1\1/u.test(lower) ||
      (/^(\p{L})\1/u.test(lower) && !lower.startsWith("ll")) ||
      (/^(\p{L}{2,4})\1\p{L}/u.test(lower) && !REDUPLICATED.test(lower))
    ) {
      runs.add(word);
    }
  }
  return [...runs];
}
