/**
 * Words the source itself runs together, and the ingest-report count that
 * shows when some get through (#520).
 *
 * The joins are not ours. SINALEVI's full text is a Word export, and its
 * typists dropped spaces: `reglamento-iva` reads «…tales <span
 * class=SpellE>losdestinados</span> al régimen devolutivo <span
 * class=SpellE>dederechos</span>.» in the payload itself. A joined word never
 * matches `search_chunks`'s lexical branch («bienes» inside «debienes») and
 * the model can quote it as written.
 *
 * The repair never guesses from a dictionary; the document is its own
 * evidence, read two ways.
 *
 * - Word's spellchecker. A token it rejected sits in a `SpellE` span
 *   (grammar complaints in `GramE`). A flagged token splits into two halves
 *   the same document uses as unflagged words: «dederechos» splits because
 *   the ficha says «derechos» elsewhere; «desalmacenar» stays whole because
 *   «salmacenar» is never a word it uses.
 * - The document's own phrasing. Word does not flag everything: much of
 *   `reglamento-iva` is Spanish tagged `lang=EN-US`, which it never checked.
 *   Any rare token splits when it reads as a function word plus a word the
 *   document writes after that function word, spaced, at least twice:
 *   «debienes» beside a dozen «de bienes». «debajo» stays whole, since
 *   nobody writes «de bajo»; so does «demás», which the document uses too
 *   often to be a slip.
 *
 * The guards on top come from the corpus survey on #520: a one-letter half
 * must be a Spanish one-letter word («y», «o», «a»), an enclitic pronoun
 * never splits off its verb («cobrarse»), an accented interrogative stays
 * with its word («porqué»), two content words split only when both halves
 * are long or a camelCase seam marks the join («ZonaFranca»), and a phrase
 * split needs more than a three-letter remainder («quedan» is not «que
 * dan»), unless that remainder is a function word itself («delos»). Three
 * real words read as two function words, and are named outright: «porque»,
 * «conque», «quede».
 */
import { decodeHTML } from "entities";

const WORD_RE = /\p{L}+(?:-\p{L}+)*/gu;
const ENTITY_RE = /(&#?\w+;)/;
const SPAN_RE = /^<(\/?)span\b([^>]*)>$/i;
const FLAG_RE = /\bclass\s*=\s*["']?(SpellE|GramE)\b/i;

/**
 * Closed-class words that run into a neighbour in the corpus: articles,
 * prepositions, conjunctions and a few determiners.
 */
const FUNCTION_WORDS = new Set(
  (
    "a al como con cuya cuyas cuyo cuyos de del e el en entre esta estas " +
    "este estos la las lo los no o otra otras otro otros para por que se " +
    "según sin sobre su sus u un una y"
  ).split(" "),
);

/** Spanish attaches these to a verb («cobrarse», «aplicarlo»): never a join. */
const ENCLITICS = new Set(["se", "lo", "la", "las", "los", "le", "les"]);

/** «porqué» — an accented interrogative is part of its word. */
const INTERROGATIVES = new Set([
  "qué",
  "cuál",
  "cuáles",
  "quién",
  "cómo",
  "dónde",
  "cuándo",
  "cuánto",
]);

const ONE_LETTER_WORDS = new Set(["a", "e", "o", "u", "y"]);

/** Real words that read as two function words the document also writes spaced. */
const NOT_JOINS = new Set(["conque", "porque", "quede"]);

/** How often the document writes «F W» spaced before «FW» reads as a join. */
const MIN_PHRASE = 2;

/**
 * A slip is rare; a token the document writes more often than this is a
 * word («demás», «porque»), whatever the phrase evidence says.
 */
const MAX_JOIN_COUNT = 2;

/** What a document vouches for. */
export interface JoinEvidence {
  /** Words outside Word's `SpellE`/`GramE` flags, with their counts. */
  words: ReadonlyMap<string, number>;
  /** «de bienes» → how often the document writes that pair, spaced. */
  pairs: ReadonlyMap<string, number>;
  /** Every token in the document, flagged or not, with its count. */
  tokens: ReadonlyMap<string, number>;
}

const pairKey = (left: string, right: string) => `${left} ${right}`;

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function wordsOf(text: string): string[] {
  return [...text.matchAll(WORD_RE)].map(([w]) => w.toLowerCase());
}

/** Token and adjacent-pair counts, reading `text` as one run of words. */
function textEvidence(text: string): {
  pairs: Map<string, number>;
  tokens: Map<string, number>;
} {
  const pairs = new Map<string, number>();
  const tokens = new Map<string, number>();
  const words = wordsOf(text);
  words.forEach((word, i) => {
    count(tokens, word);
    if (i > 0) count(pairs, pairKey(words[i - 1], word));
  });
  return { pairs, tokens };
}

/**
 * A function word glued to a word the document otherwise writes after it,
 * spaced: «debienes» → «de bienes». Shared by the repair and the report.
 */
function phraseSeam(
  token: string,
  pairs: ReadonlyMap<string, number>,
): number | null {
  const lower = token.toLowerCase();
  if (NOT_JOINS.has(lower)) return null;
  let best: { at: number; score: number } | null = null;
  for (const prefix of FUNCTION_WORDS) {
    if (prefix.length === 1 || !lower.startsWith(prefix)) continue;
    const rest = lower.slice(prefix.length);
    if (rest.length < 4 && !(rest.length > 1 && FUNCTION_WORDS.has(rest))) {
      continue;
    }
    if (INTERROGATIVES.has(rest)) continue;
    const score = pairs.get(pairKey(prefix, rest)) ?? 0;
    if (score >= MIN_PHRASE && (!best || score > best.score)) {
      best = { at: prefix.length, score };
    }
  }
  return best?.at ?? null;
}

function isHalf(part: string, words: ReadonlyMap<string, number>): boolean {
  return part.length === 1 ? ONE_LETTER_WORDS.has(part) : words.has(part);
}

/** The seam a `SpellE` token splits at when both halves are unflagged words. */
function vocabularySeam(
  token: string,
  words: ReadonlyMap<string, number>,
): number | null {
  const lower = token.toLowerCase();
  let best: { score: number; at: number } | null = null;
  for (let at = 1; at < token.length; at++) {
    const left = lower.slice(0, at);
    const right = lower.slice(at);
    if (!isHalf(left, words) || !isHalf(right, words)) continue;
    if (INTERROGATIVES.has(right)) continue;
    const functionSeam =
      FUNCTION_WORDS.has(left) ||
      (FUNCTION_WORDS.has(right) && !ENCLITICS.has(right));
    const camelSeam =
      /\p{Ll}/u.test(token[at - 1]) &&
      /\p{Lu}/u.test(token[at]) &&
      left.length >= 3 &&
      right.length >= 3;
    const contentSeam = left.length >= 4 && right.length >= 4;
    if (!functionSeam && !camelSeam && !contentSeam) continue;
    // Where several seams qualify («dela»: «de la» or «del a»), the one whose
    // rarer half the document uses most wins.
    const score = Math.min(
      words.get(left) ?? Infinity,
      words.get(right) ?? Infinity,
    );
    if (!best || score > best.score) best = { score, at };
  }
  return best?.at ?? null;
}

/**
 * The two-word reading of `token`, or null when the document gives no honest
 * evidence for one. `flagged`: the token sits in a `SpellE` span.
 */
export function splitJoinedWord(
  token: string,
  evidence: JoinEvidence,
  flagged: boolean,
): string | null {
  const lower = token.toLowerCase();
  if (lower.includes("-")) return null;
  const at =
    (flagged && !evidence.words.has(lower)
      ? vocabularySeam(token, evidence.words)
      : null) ??
    ((evidence.tokens.get(lower) ?? 0) <= MAX_JOIN_COUNT
      ? phraseSeam(token, evidence.pairs)
      : null);
  return at == null ? null : `${token.slice(0, at)} ${token.slice(at)}`;
}

interface TextNode {
  index: number;
  text: string;
  spell: boolean;
  grammar: boolean;
}

/** Tags and text in order, each text node knowing which flags enclose it. */
function walk(html: string): { parts: string[]; nodes: TextNode[] } {
  const parts = html.match(/<[^>]*>|[^<]+/g) ?? [];
  const stack: (string | null)[] = [];
  const nodes: TextNode[] = [];
  parts.forEach((part, index) => {
    const span = part.match(SPAN_RE);
    if (span) {
      if (span[1]) stack.pop();
      else stack.push(span[2].match(FLAG_RE)?.[1].toLowerCase() ?? null);
      return;
    }
    if (part.startsWith("<")) return;
    nodes.push({
      index,
      text: part,
      spell: stack.includes("spelle"),
      grammar: stack.includes("grame"),
    });
  });
  return { parts, nodes };
}

function evidenceOf(nodes: readonly TextNode[]): JoinEvidence {
  const words = new Map<string, number>();
  for (const node of nodes) {
    if (node.spell || node.grammar) continue;
    for (const word of wordsOf(decodeHTML(node.text))) count(words, word);
  }
  // Pairs span text nodes — Word opens a span mid-sentence — so they are
  // read off the document as one run of text.
  const text = decodeHTML(nodes.map((n) => n.text).join(" "));
  return { words, ...textEvidence(text) };
}

/** «gratuito,incluida», «informaciones.Las» — punctuation with no space after it. */
function spacePunctuation(text: string): string {
  return text
    .replace(/(?<=\p{L})([,;])(?=\p{L})/gu, "$1 ")
    .replace(/(?<=\p{Ll})\.(?=\p{Lu})/gu, ". ");
}

/** Apply `fix` to the text between entities, never to an entity itself. */
function outsideEntities(text: string, fix: (s: string) => string): string {
  return text
    .split(ENTITY_RE)
    .map((piece, i) => (i % 2 === 1 ? piece : fix(piece)))
    .join("");
}

/**
 * Word-export HTML with the joins the document gives evidence for repaired;
 * everything else, markup included, is returned byte for byte.
 */
export function repairWordJoins(html: string): string {
  const { parts, nodes } = walk(html);
  const evidence = evidenceOf(nodes);
  for (const node of nodes) {
    parts[node.index] = outsideEntities(node.text, (piece) =>
      (node.spell || node.grammar ? spacePunctuation(piece) : piece).replace(
        WORD_RE,
        (word) => splitJoinedWord(word, evidence, node.spell) ?? word,
      ),
    );
  }
  return parts.join("");
}

/**
 * Tokens in extracted text that still read as a function word glued to the
 * next word, by the same phrase evidence the repair uses. Reads only text,
 * so it covers every document kind, PDFs included. The texts are read as one
 * run, as the repair reads its document: SINALEVI paragraphs break at the
 * source's line ends, mid-sentence, and a pair split there still counts.
 */
export function suspiciousJoins(texts: readonly string[]): string[] {
  const { pairs, tokens } = textEvidence(texts.join("\n"));
  const found: string[] = [];
  for (const [word, n] of tokens) {
    if (n > MAX_JOIN_COUNT || word.includes("-")) continue;
    if (phraseSeam(word, pairs) != null) found.push(word);
  }
  return found.sort();
}

/** The ingest report's line for one document: a count, and samples when any. */
export function wordJoinNotice(
  docKey: string,
  texts: readonly string[],
): { level: "info" | "warn"; message: string } {
  const joins = suspiciousJoins(texts);
  if (joins.length === 0) {
    return { level: "info", message: `${docKey}: 0 suspicious word joins` };
  }
  const shown = joins.slice(0, 12).join(", ");
  const more = joins.length > 12 ? `, … ${joins.length - 12} more` : "";
  return {
    level: "warn",
    message: `${docKey}: ${joins.length} suspicious word join${joins.length === 1 ? "" : "s"} — a function word run into the next word, which lexical search cannot match (#520): ${shown}${more}`,
  };
}
