/**
 * Words the source itself runs together, the repair, and the ingest-report
 * lines that show both what it split and what got through (#520).
 *
 * The joins are not ours. SINALEVI's full text is a Word export, and its
 * typists dropped spaces: `reglamento-iva` reads «…tales <span
 * class=SpellE>losdestinados</span> al régimen devolutivo <span
 * class=SpellE>dederechos</span>.» in the payload itself. A joined word never
 * matches `search_chunks`'s lexical branch («bienes» inside «debienes») and
 * the model can quote it as written.
 *
 * The repair never guesses from a dictionary; the document is its own
 * evidence, and how much evidence a split needs depends on what Word said
 * about the token (`Proofing`):
 *
 * - `flagged` — Word's spellchecker rejected it (a `SpellE` span). It splits
 *   into two halves Word accepted elsewhere in the same document:
 *   «dederechos» splits because the ficha says «derechos»; «desalmacenar»
 *   stays whole because «salmacenar» is never a word it uses. Failing that,
 *   a function word splits off when the document writes the pair spaced at
 *   least twice.
 * - `unchecked` — Word never looked: much of `reglamento-iva` is Spanish
 *   tagged `lang=EN-US`, and Word skips words in capitals. A function word
 *   splits off only when the document writes the pair spaced at least three
 *   times and three times as often as the token («debienes» beside 141 «de
 *   bienes»), and never when Word accepted the token elsewhere in the
 *   document.
 * - `checked` — Spanish text Word checked and did not flag: a word, by
 *   Word's own reading. Only two function words run together split there
 *   («delos», «dela»), on the same strict phrase evidence.
 *
 * The guards on top come from the corpus survey on #520 and its review: a
 * one-letter half must be a Spanish one-letter word («y», «o», «a»); an
 * enclitic pronoun never splits off its verb («cobrarse»); an accented
 * interrogative stays with its word («porqué»); two content words split only
 * when both halves are long and the first is not a word-building prefix
 * («dominiopleno», not «parauniversitaria» or «sociolaboral»); a phrase
 * split needs more than a three-letter remainder («quedan» is not «que
 * dan») unless the remainder is a function word itself; an identifier
 * («CodigoActividad», «ZonaFranca») splits only after a lowercase function
 * word («laAutoridad»); and an email address or URL is never read at all.
 */
import { decodeHTML } from "entities";

const WORD_RE = /\p{L}+(?:-\p{L}+)*/gu;
/** A word, or a whole email address or URL that must stay as written. */
const TOKEN_RE = /[^\s<>]*[@/][^\s<>]*|www\.[^\s<>]*|\p{L}+(?:-\p{L}+)*/gu;
const ALL_CAPS_RE = /^\p{Lu}{2,}$/u;
const SPAN_RE = /^<(\/?)span\b([^>]*)>$/i;
const FLAG_RE = /\bclass\s*=\s*["']?(SpellE|GramE)\b/i;
const LANG_RE = /\blang\s*=\s*["']?([\w-]+)|mso-ansi-language\s*:\s*([\w-]+)/i;

/**
 * Closed-class words that run into a neighbour in the corpus: articles,
 * prepositions, conjunctions and a few determiners. «para», «sobre» and
 * «entre» are left out: Spanish builds words with them («parauniversitaria»,
 * «sobretasa», «entrelazar»), so a seam after one is no evidence of a slip.
 */
const FUNCTION_WORDS = new Set(
  (
    "a al como con cuya cuyas cuyo cuyos de del e el en esta estas este " +
    "estos la las lo los no o otra otras otro otros por que se según sin " +
    "su sus u un una y"
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

/**
 * Spanish builds words on these («parauniversitaria», «radiodifusión»), so
 * two content words never split after one: the first half is a prefix, not
 * a word the typist forgot to space.
 */
const WORD_BUILDING_PREFIXES = new Set(
  (
    "agro ante anti audio auto ciber contra electro entre extra foto geo " +
    "hidro infra info inter macro maxi micro mini multi para pluri poli " +
    "radio semi sobre socio super tecno tele termo ultra video"
  ).split(" "),
);

/** Real words that read as two function words the document also writes spaced. */
const NOT_JOINS = new Set(["conque", "porque", "quede", "sede"]);

/** What Word said about a token, and so how much evidence a split needs. */
export type Proofing = "flagged" | "unchecked" | "checked";

/** The phrase evidence a seam needs, by proofing. */
const PHRASE_BAR: Record<
  Proofing,
  { minimum: number; outnumber: number; rareUpTo: number }
> = {
  // Word already called it a misspelling: two spaced uses vouch for the seam,
  // and the pair need only outnumber a token the document writes often.
  flagged: { minimum: 2, outnumber: 5, rareUpTo: 2 },
  // Nobody called it anything: three spaced uses, outnumbering the token
  // three to one however rare it is. The real joins in today's corpus clear
  // it at 3–4 uses to 1 («de previo», «del título»); a word the document
  // writes as itself («consumo», 15 to 0 «con sumo») does not.
  unchecked: { minimum: 3, outnumber: 3, rareUpTo: 0 },
  checked: { minimum: 3, outnumber: 3, rareUpTo: 0 },
};

/** What a document vouches for. */
export interface JoinEvidence {
  /** Words Word checked as Spanish and accepted, with their counts. */
  words: ReadonlyMap<string, number>;
  /** «de bienes» → how often the document writes that pair, spaced. */
  pairs: ReadonlyMap<string, number>;
  /** Every token in the document, whatever Word said, with its count. */
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

/** Two function words run together: «delos», «dela», «enlas». */
function functionPair(lower: string, at: number): boolean {
  return (
    FUNCTION_WORDS.has(lower.slice(0, at)) &&
    FUNCTION_WORDS.has(lower.slice(at))
  );
}

/**
 * A function word glued to a word the document otherwise writes beside it,
 * spaced: «debienes» → «de bienes», «plazode» → «plazo de». Shared by the
 * repair and the report.
 */
function phraseSeam(
  token: string,
  { pairs, tokens }: Pick<JoinEvidence, "pairs" | "tokens">,
  proofing: Proofing,
): number | null {
  const lower = token.toLowerCase();
  if (NOT_JOINS.has(lower)) return null;
  const bar = PHRASE_BAR[proofing];
  const uses = tokens.get(lower) ?? 0;
  const seams: number[] = [];
  for (const word of FUNCTION_WORDS) {
    if (word.length === 1) continue;
    const rest = lower.slice(word.length);
    if (
      lower.startsWith(word) &&
      (rest.length >= 4 || (rest.length > 1 && FUNCTION_WORDS.has(rest))) &&
      !INTERROGATIVES.has(rest)
    ) {
      seams.push(word.length);
    }
    // Trailing: the head must be a word of its own length, and a pronoun
    // after a verb is an enclitic («cobrarse»), not a slip.
    const head = lower.length - word.length;
    if (lower.endsWith(word) && head >= 4 && !ENCLITICS.has(word)) {
      seams.push(head);
    }
  }
  let best: { at: number; score: number } | null = null;
  for (const at of seams) {
    if (proofing === "checked" && !functionPair(lower, at)) continue;
    const score = pairs.get(pairKey(lower.slice(0, at), lower.slice(at))) ?? 0;
    const vouched =
      score >= bar.minimum &&
      (uses <= bar.rareUpTo || score >= bar.outnumber * uses);
    if (vouched && (!best || score > best.score)) best = { at, score };
  }
  return best?.at ?? null;
}

function isHalf(part: string, words: ReadonlyMap<string, number>): boolean {
  return part.length === 1 ? ONE_LETTER_WORDS.has(part) : words.has(part);
}

/** The seam a `SpellE` token splits at when both halves are accepted words. */
function vocabularySeam(
  token: string,
  words: ReadonlyMap<string, number>,
): number | null {
  const lower = token.toLowerCase();
  let best: { at: number; score: number } | null = null;
  for (let at = 1; at < token.length; at++) {
    const left = lower.slice(0, at);
    const right = lower.slice(at);
    if (!isHalf(left, words) || !isHalf(right, words)) continue;
    if (INTERROGATIVES.has(right)) continue;
    const functionSeam =
      FUNCTION_WORDS.has(left) ||
      (FUNCTION_WORDS.has(right) && !ENCLITICS.has(right));
    const contentSeam =
      left.length >= 4 &&
      right.length >= 4 &&
      !WORD_BUILDING_PREFIXES.has(left);
    if (!functionSeam && !contentSeam) continue;
    // Where several seams qualify («dela»: «de la» or «del a»), the one whose
    // rarer half the document uses most wins.
    const score = Math.min(
      words.get(left) ?? Infinity,
      words.get(right) ?? Infinity,
    );
    if (!best || score > best.score) best = { at, score };
  }
  return best?.at ?? null;
}

/**
 * Where a token's case changes mid-word, the token is an identifier
 * («CodigoActividad») or a proper name, unless a lowercase function word
 * opens it («laAutoridad», «delTítulo»). Returns the seam that may split, or
 * null when the token must stay whole; undefined when it has no such change.
 */
function caseSeam(token: string): number | null | undefined {
  const inner = token.slice(1).search(/\p{Lu}/u);
  if (inner < 0 || /^\p{Lu}+$/u.test(token)) return undefined;
  const at = inner + 1;
  const left = token.slice(0, at);
  return /^\p{Ll}+$/u.test(left) && FUNCTION_WORDS.has(left) ? at : null;
}

/** What Word said about this token: it skips words in capitals, whatever their span says. */
function proofingOf(token: string, span: Proofing): Proofing {
  return span !== "flagged" && ALL_CAPS_RE.test(token) ? "unchecked" : span;
}

/**
 * The two-word reading of `token`, or null when the document gives no honest
 * evidence for one at the bar its `proofing` sets.
 */
export function splitJoinedWord(
  token: string,
  evidence: JoinEvidence,
  proofing: Proofing,
): string | null {
  const lower = token.toLowerCase();
  if (lower.includes("-")) return null;
  const read = proofingOf(token, proofing);
  let at: number | null;
  if (read === "flagged") {
    at =
      (evidence.words.has(lower)
        ? null
        : vocabularySeam(token, evidence.words)) ??
      phraseSeam(token, evidence, read);
  } else {
    at = phraseSeam(token, evidence, read);
    // Word accepted this token where it did check: a word, unless it is two
    // function words, which no Spanish word is.
    if (
      at != null &&
      read === "unchecked" &&
      evidence.words.has(lower) &&
      !functionPair(lower, at)
    ) {
      at = null;
    }
  }
  const caseAt = caseSeam(token);
  if (caseAt !== undefined && at !== caseAt) return null;
  return at == null ? null : `${token.slice(0, at)} ${token.slice(at)}`;
}

interface SpanFrame {
  flag: string | null;
  lang: string | null;
}

interface TextNode {
  index: number;
  text: string;
  proofing: Proofing;
  /** Inside a `GramE` span: Word's grammar checker complained. */
  grammar: boolean;
}

/** Tags and text in order, each text node knowing what Word said about it. */
function walk(html: string): { parts: string[]; nodes: TextNode[] } {
  const parts = html.match(/<[^>]*>|[^<]+/g) ?? [];
  const stack: SpanFrame[] = [];
  const nodes: TextNode[] = [];
  parts.forEach((part, index) => {
    const span = part.match(SPAN_RE);
    if (span) {
      if (span[1]) stack.pop();
      else {
        const lang = span[2].match(LANG_RE);
        stack.push({
          flag: span[2].match(FLAG_RE)?.[1].toLowerCase() ?? null,
          lang: (lang?.[1] ?? lang?.[2])?.toLowerCase() ?? null,
        });
      }
      return;
    }
    if (part.startsWith("<")) return;
    const lang = stack.findLast((frame) => frame.lang)?.lang;
    nodes.push({
      index,
      text: part,
      proofing: stack.some((frame) => frame.flag === "spelle")
        ? "flagged"
        : lang && !lang.startsWith("es")
          ? "unchecked"
          : "checked",
      grammar: stack.some((frame) => frame.flag === "grame"),
    });
  });
  return { parts, nodes };
}

function evidenceOf(nodes: readonly TextNode[]): JoinEvidence {
  const words = new Map<string, number>();
  for (const node of nodes) {
    if (node.proofing !== "checked" || node.grammar) continue;
    for (const [word] of decodeHTML(node.text).matchAll(WORD_RE)) {
      // Word skips a word in capitals, so its silence vouches for nothing.
      if (!ALL_CAPS_RE.test(word)) count(words, word.toLowerCase());
    }
  }
  // Pairs span text nodes — Word opens a span mid-sentence — so they are
  // read off the document as one run of text.
  const text = decodeHTML(nodes.map((n) => n.text).join(" "));
  return { words, ...textEvidence(text) };
}

/** «gratuito,incluida», «informaciones.Las» — punctuation with no space after it. */
const PUNCTUATION_RE = /(?<=\p{L})[,;](?=\p{L})|(?<=\p{Ll})\.(?=\p{Lu})/gu;

/** Text back into markup, for `htmlToParagraphs` to decode a second time. */
const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One change the repair made, for the ingest report. */
export interface WordRepair {
  /** `split` a token in two, or `spaced` punctuation inside a Word flag. */
  kind: "split" | "spaced";
  from: string;
  to: string;
  /** What Word said about the token; `spaced` only ever happens under a flag. */
  proofing: Proofing;
}

/**
 * Word-export HTML with the joins the document gives evidence for repaired,
 * and every repair it made; everything else, markup included, is returned
 * byte for byte.
 */
export function repairWordJoins(html: string): {
  html: string;
  repairs: WordRepair[];
} {
  const { parts, nodes } = walk(html);
  const evidence = evidenceOf(nodes);
  const repairs: WordRepair[] = [];
  for (const node of nodes) {
    // Decoded first, so «t&iacute;tulo» is read as the one word it is.
    const text = decodeHTML(node.text);
    const flagged = node.proofing === "flagged" || node.grammar;
    const spaced = flagged
      ? text.replace(PUNCTUATION_RE, (mark: string, offset: number) => {
          const before = text.slice(0, offset).match(/\S*$/u)![0];
          const after = text.slice(offset + 1).match(/^\S*/u)![0];
          repairs.push({
            kind: "spaced",
            from: `${before}${mark}${after}`,
            to: `${before}${mark} ${after}`,
            proofing: node.proofing,
          });
          return `${mark} `;
        })
      : text;
    const repaired = spaced.replace(TOKEN_RE, (token) => {
      if (/[@/.]/.test(token)) return token;
      const split = splitJoinedWord(token, evidence, node.proofing);
      if (split == null) return token;
      repairs.push({
        kind: "split",
        from: token,
        to: split,
        proofing: proofingOf(token, node.proofing),
      });
      return split;
    });
    if (repaired !== text) parts[node.index] = escapeText(repaired);
  }
  return { html: parts.join(""), repairs };
}

/**
 * Tokens in extracted text that still read as a function word glued to a
 * neighbour, at the lenient bar a `SpellE` token gets — lower than any the
 * repair applies to unflagged text, so a near miss the repair declined
 * («defraude» beside one «de fraude») shows up here instead of vanishing.
 * Reads only text, so it covers every document kind, PDFs included. The
 * texts are read as one run, as the repair reads its document: SINALEVI
 * paragraphs break at the source's line ends, mid-sentence, and a pair split
 * there still counts.
 */
export function suspiciousJoins(texts: readonly string[]): string[] {
  const { pairs, tokens } = textEvidence(texts.join("\n"));
  const found: string[] = [];
  for (const word of tokens.keys()) {
    if (word.includes("-")) continue;
    if (phraseSeam(word, { pairs, tokens }, "flagged") != null) {
      found.push(word);
    }
  }
  return found.sort();
}

/**
 * Spanish words this long are rare enough to read by eye: #520's survey used
 * the same cut, and found «empresasconsolidadoras» beside the legitimate
 * «agroindustrialización».
 */
const LONG_WORD = 19;

/**
 * Distinct words of `LONG_WORD` letters or more. It shares no rule with the
 * repair, so it catches the joins no evidence vouches for.
 */
export function longWords(texts: readonly string[]): string[] {
  const { tokens } = textEvidence(texts.join("\n"));
  return [...tokens.keys()]
    .filter((word) => !word.includes("-") && [...word].length >= LONG_WORD)
    .sort();
}

/** How many of each list the report line names before it summarises. */
const SAMPLES = 12;

function sample(words: readonly string[]): string {
  const more =
    words.length > SAMPLES ? `, … ${words.length - SAMPLES} more` : "";
  return `${words.slice(0, SAMPLES).join(", ")}${more}`;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** An ingest-report line for one document. */
export interface WordJoinNotice {
  /** `warn` deserves the ⚠ and a reader's attention; `info` is a receipt. */
  level: "info" | "warn";
  message: string;
}

const PROOFING_LABEL: Record<Proofing, string> = {
  flagged: "Word flagged",
  unchecked: "Word never checked",
  checked: "Word checked and accepted",
};

/**
 * What the repair changed in one payload, so a wrong split on a future
 * recrawl is visible in the run that made it. Splits of a token Word did not
 * flag are listed on lines of their own: the evidence for those is the
 * document's phrasing alone. A receipt, not a warning — every run repairs
 * the same few hundred joins, and a ⚠ that never goes away is one nobody
 * reads; the ⚠ belongs to what `wordJoinNotice` finds left over.
 */
export function wordRepairNotice(
  docKey: string,
  repairs: readonly WordRepair[],
): WordJoinNotice {
  const splits = repairs.filter((r) => r.kind === "split");
  const spaced = repairs.filter((r) => r.kind === "spaced");
  const lines = [
    `${docKey}: repaired ${plural(splits.length, "joined word")} and ${plural(spaced.length, "unspaced punctuation mark")} in the payload (#520)`,
  ];
  const shown = (list: readonly WordRepair[]) =>
    sample([...new Set(list.map((r) => `${r.from}→${r.to}`))]);
  for (const proofing of ["flagged", "unchecked", "checked"] as const) {
    const these = splits.filter((r) => r.proofing === proofing);
    if (these.length > 0) {
      lines.push(
        `    ${PROOFING_LABEL[proofing]} (${these.length}): ${shown(these)}`,
      );
    }
  }
  if (spaced.length > 0) lines.push(`    punctuation: ${shown(spaced)}`);
  return { level: "info", message: lines.join("\n") };
}

/**
 * What got through, for one document's extracted text: function-word joins
 * left after the repair, and the long words to read by eye. Only a join
 * warns: a legitimate long word («agroindustrialización») would otherwise
 * warn forever.
 */
export function wordJoinNotice(
  docKey: string,
  texts: readonly string[],
): WordJoinNotice {
  const joins = suspiciousJoins(texts);
  const long = longWords(texts);
  const lines = [
    `${docKey}: ${plural(joins.length, "suspicious word join")}, ${plural(long.length, "word")} of ${LONG_WORD}+ letters (#520)`,
  ];
  if (joins.length > 0) {
    lines.push(
      `    joins (a function word run into its neighbour, which lexical search cannot match): ${sample(joins)}`,
    );
  }
  if (long.length > 0) lines.push(`    long: ${sample(long)}`);
  return {
    level: joins.length > 0 ? "warn" : "info",
    message: lines.join("\n"),
  };
}
