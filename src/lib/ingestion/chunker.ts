/**
 * Por-artículo chunker (SPEC §4, validated by the prototype on branch
 * `prototype/chunking`): one chunk per artículo/transitorio with a structural
 * context header, no overlap between artículos, sub-split of long artículos,
 * preámbulo tagged, unstructured docs as a whole-doc chunk.
 */

export interface Chunk {
  docKey: string;
  articulo: string | null;
  path: string[];
  part: number;
  content: string;
}

// Case-sensitive on the first letter: article headings are capitalized
// ("Artículo 11.-" / "ARTÍCULO 2-"), while quoted reform references inside a
// paragraph ("...según el artículo 304 del decreto...") are not — the first
// ingestion run showed those create false boundaries if matched.
const ART_RE =
  /^(ART[ÍI]CULO\s+\d+(?:\s*(?:BIS|TER))?|Art[íi]culo\s+\d+(?:\s*(?:bis|ter))?|TRANSITORIO\s+[IVXLCDM\d]+|Transitorio\s+[IVXLCDM\d]+)\b[ .°\-–—]*/;
// Same first-letter case rule as ART_RE: real headings are capitalized
// ("SECCIÓN II" / "Capítulo IV"), while in-sentence references that extraction
// breaks onto their own line ('sección "Propuestas en consulta pública"…',
// "título gratuito y con fines de interés social…") are not — the RES-0027-2024
// ingestion showed those mislabel every following chunk's citation path.
//
// Case alone is not enough (#237): extraction also wraps sentences so that a
// capitalized reference opens a line ("Título I, a un nuevo marco normativo,
// denominado Ley del Impuesto sobre el"), and a TÍTULO mismatch is level 0 —
// nothing ever pops it, so it poisons every path in the document. A real
// heading is structural: heading word, then an ordinal (roman numeral —
// "CAPÍTULO Vl" with an OCR'd lowercase l included — number, or ÚNICO/ÚNICA),
// then nothing or a caption after a delimiter. The ordinal must end its token:
// "Título I," carries a comma and is prose.
const HDR_WORD =
  "T[ÍI]TULO|T[íi]tulo|CAP[ÍI]TULO|Cap[íi]tulo|SECCI[ÓO]N|Secci[óo]n";
const HDR_LINE_RE = new RegExp(
  `^(?:${HDR_WORD})\\s+(?:[IVXLCDM]+l*|\\d+|[ÚU]NIC[OA]|[ÚU]nic[oa])(?:[.\\-–—°:\\s]+([\\s\\S]*))?$`,
);

// A heading's caption is a title line — ALL CAPS ("EXENCIONES Y NO
// SUJECIONES") or capitalized title case ("De la determinación del impuesto").
// An all-caps line can never be body prose in these documents, so only a word
// budget bounds it: ley-9635's transitorio captions name the reformed ley
// ("REFORMAS DE LA LEY N.° 7092, …") and run past twenty words with periods
// inside. A mixed-case line can be a wrapped sentence fragment, so it must
// also not dangle — end in a comma, sentence punctuation, or a lowercase
// function word ("…denominado Ley del Impuesto sobre el"). The function-word
// list is every common preposition, article and demonstrative, not just the
// endings the corpus has produced so far — a wrapped sentence can break on
// any of them.
const LOWERCASE_RE = /[a-záéíóúñü]/;
const ALL_CAPS_CAPTION_MAX_WORDS = 40;
const CAPTION_MAX_WORDS = 20;
const CAPTION_DANGLING_END_RE =
  /(?:^|\s)(?:al?|ambos|ante|bajo|como|con|contra|de|del?|desde|durante|el|en|entre|est[aeo]s?|hacia|hasta|las?|los?|mediante|o|para|por|que|se|según|sin|sobre|sus?|tras|u|una?|y)$|[.,:;]$/;

function isCaption(text: string): boolean {
  if (!/^[A-ZÁÉÍÓÚÑÜ]/.test(text)) return false;
  const words = text.split(/\s+/).length;
  if (!LOWERCASE_RE.test(text)) return words <= ALL_CAPS_CAPTION_MAX_WORDS;
  return words <= CAPTION_MAX_WORDS && !CAPTION_DANGLING_END_RE.test(text);
}

/** A structural heading line: heading word + ordinal, alone or captioned. */
function isHeadingLine(p: string): boolean {
  const m = p.match(HDR_LINE_RE);
  if (!m) return false;
  const caption = m[1]?.trim() ?? "";
  return caption.length === 0 || isCaption(caption);
}

// Some consolidated texts (Ley IVA) glue the capítulo heading and the first
// artículo into one extracted paragraph, so ART_RE's ^ anchor never fires and
// whole capítulos become unlabeled blobs (ADR 0002 amendment, found during
// ADR 0003). Pre-split at inline headings; unlike ART_RE, a delimiter after
// the number is REQUIRED so mid-sentence references ("el Artículo 8 de esta
// ley") don't split — real inline headings always carry one ("Artículo 8-").
const INLINE_ART_RE =
  /(?<!^)(?=(?:ART[ÍI]CULO|Art[íi]culo)\s+\d+(?:\s*(?:bis|ter|BIS|TER))?\s*[.\-–—°]|(?:TRANSITORIO|Transitorio)\s+[IVXLCDM\d]+\s*[.\-–—°])/;

function splitInlineHeadings(paragraph: string): string[] {
  return paragraph
    .split(INLINE_ART_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Ley IVA's markup also fragments headings across paragraphs — "Artículo" /
// "8- Exenciones…" and "CAPÍTULO" / "III" / "EXENCIONES" / "Y TASA DEL
// IMPUESTO" each arrive as separate extracted paragraphs, so neither ART_RE
// nor HDR_LINE_RE ever sees a whole heading. Rejoin those fragments first.
const FRAG_ART_WORD_RE = /^(ART[ÍI]CULO|Art[íi]culo|TRANSITORIO|Transitorio)$/;
const FRAG_HDR_WORD_RE = new RegExp(`^(?:${HDR_WORD})$`);
const FRAG_NUM_START_RE = /^(\d|[IVXLCDM]+\b)/;

/** Structure a caption can never cross: an artículo or heading start. */
function isStructuralBoundary(line: string): boolean {
  return (
    FRAG_ART_WORD_RE.test(line) ||
    FRAG_HDR_WORD_RE.test(line) ||
    isHeadingLine(line) ||
    ART_RE.test(line)
  );
}

/** A line carrying sentence punctuation among lowercase — prose, not caption. */
function isSentenceLike(line: string): boolean {
  return LOWERCASE_RE.test(line) && /[.:;]/.test(line);
}

export function normalizeFragments(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    let p = paragraphs[i];
    const next = paragraphs[i + 1];
    if (FRAG_ART_WORD_RE.test(p) && next && FRAG_NUM_START_RE.test(next)) {
      p = `${p} ${paragraphs[++i]}`;
      out.push(p);
      continue;
    }
    if (FRAG_HDR_WORD_RE.test(p) && next && FRAG_NUM_START_RE.test(next)) {
      p = `${p} ${paragraphs[++i]}`;
    }
    // A heading owns its caption line(s), however the heading arrived —
    // fragmented and rejoined above, or whole ("CAPÍTULO I" followed by
    // "TRABAJADORES INDEPENDIENTES", #237). Left unabsorbed, the caption
    // flushes as an untagged chunk with no citable artículo.
    //
    // Captions wrap: "De los saldos a favor, devoluciones y reembolsos del" +
    // "impuesto" only read as a caption once joined, so collect forward to
    // the next structural boundary (artículo or heading) and absorb only if
    // the joined text is caption-shaped and actually reaches that boundary.
    // Wrapped prose fails on its sentence punctuation, its length, or its
    // dangling end — and anything rejected stays a chunk, the status quo.
    if (isHeadingLine(p)) {
      let j = i;
      const collected: string[] = [];
      while (
        j + 1 < paragraphs.length &&
        collected.length < 6 &&
        !isStructuralBoundary(paragraphs[j + 1]) &&
        !isSentenceLike(paragraphs[j + 1]) &&
        !/DECRETA/.test(paragraphs[j + 1])
      ) {
        collected.push(paragraphs[++j]);
      }
      const caption = collected.join(" ");
      const reachedBoundary =
        j + 1 >= paragraphs.length || isStructuralBoundary(paragraphs[j + 1]);
      if (collected.length > 0 && reachedBoundary && isCaption(caption)) {
        p = `${p} ${caption}`;
        i = j;
      }
    }
    out.push(p);
  }
  return out;
}

// SPEC §4 rule 3 splits everything before a document's first heading into two
// halves. The enacting formula ("DECRETA:", "Por tanto, Decretan:", a
// ministerial "dispone:") separates them: the norm number, the issuing
// authority and the ley's own title are doc metadata and must never become
// retrievable chunks, while the recitals between the authority line and the
// formula are the preámbulo — one chunk, tagged (#216).
//
// The colon is required — real formulas always carry one — and the *last*
// match wins: a considerando that quotes another norma ("el artículo 5
// dispone:") sits before the formula, never after it, so anchoring on the last
// occurrence keeps a quotation from cutting the recitals short.
const ENACTING_FORMULA_RE =
  /\b(?:DECRETA|ACUERDA|RESUELVE|DISPONE|ORDENA|EMITE|ADOPTA)N?\s*:/gi;
// Where the recitals begin. Matched against the front matter *joined*, not
// per paragraph: extraction line-wraps these documents, so "Con" and
// "fundamento en las atribuciones…" arrive as separate paragraphs and no
// single one carries a whole opening.
const PREAMBLE_START_RE =
  /\bConsiderandos?\s*:|\bResultandos?\s*:|\bCon\s+fundamento\s+en\b|\bEn\s+uso\s+de\s+(?:las|sus)\b|\bEn\s+ejercicio\s+de\s+(?:las|sus)\b/i;
// A twelve-word-or-longer sentence: the fallback that tells recitals opened by
// wording this file has never seen from a title block. Dropping front matter
// is only safe when there is nothing in it to lose — silent content loss is
// the #114/#206 failure mode — so anything that reads as prose is kept even
// though a title line or two may ride along with it. Title blocks are name,
// number and issuing authority; none of them is a sentence.
const RECITAL_PROSE_RE = /(?:\S+\s+){11,}\S*\.(?:\s|$)/;

/**
 * The preámbulo carried by a document's front matter, or `null` when the front
 * matter is title block only (SPEC §4 rule 3).
 */
function preambleOf(frontMatter: string): string | null {
  let cut = frontMatter.length;
  for (const formula of frontMatter.matchAll(ENACTING_FORMULA_RE)) {
    cut = formula.index;
  }
  const recitals = frontMatter.slice(0, cut);
  const start = recitals.match(PREAMBLE_START_RE);
  const text = (
    start?.index === undefined
      ? RECITAL_PROSE_RE.test(recitals)
        ? recitals
        : ""
      : recitals.slice(start.index)
  ).trim();
  return text.length > 0 ? text : null;
}

const MAX_WORDS = 1000;
const OVERLAP_WORDS = 100;

function subsplit(body: string): string[] {
  const words = body.split(" ");
  if (words.length <= MAX_WORDS) return [body];
  const parts: string[] = [];
  const step = MAX_WORDS - OVERLAP_WORDS;
  for (let i = 0; i < words.length; i += step) {
    parts.push(words.slice(i, i + MAX_WORDS).join(" "));
    if (i + MAX_WORDS >= words.length) break;
  }
  return parts;
}

function headerLevel(header: string): number {
  const word = header.split(/\s/)[0].toUpperCase();
  if (word.startsWith("T")) return 0;
  if (word.startsWith("C")) return 1;
  return 2;
}

export interface ChunkOptions {
  /**
   * Stamp every chunk with this label and skip heading segmentation entirely.
   *
   * For documents that have no artículo structure of their own — a CCSS acta
   * de Junta Directiva, a ficha técnica (issue #114) — every article-shaped
   * string is a *quotation* of some other norma, structurally identical to a
   * real heading. Segmenting on those invents labels that are wrong as
   * citations: the vigente Salud escala would be cited as "Artículo 11" (an
   * article of the Reglamento del Asegurado Voluntario the acta happens to
   * quote just above the table). The honest citable unit for these documents
   * is the acta artículo under which the acuerdo was adopted, which only the
   * manifest knows.
   */
  articulo?: string;
}

export function chunkDocument(
  docKey: string,
  title: string,
  paragraphs: string[],
  options: ChunkOptions = {},
): Chunk[] {
  if (options.articulo !== undefined) {
    // No body, no chunk (#206). `[].join(" ")` is `""`, and `"".split(" ")` is
    // `[""]`, so without this guard a document whose extraction recovered
    // nothing still produced one header-only chunk — enough to satisfy the
    // runner's `chunks.length === 0` check while `replace_chunks` deleted the
    // document's real chunks. Silent content loss is the #114 failure mode.
    const body = paragraphs.join(" ").trim();
    if (body.length === 0) return [];
    const header = `[${title} — ${options.articulo}]`;
    return subsplit(body).map((part, i) => ({
      docKey,
      articulo: options.articulo!,
      path: [],
      part: i,
      content: `${header} ${part}`,
    }));
  }

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let label: string | null = null;
  let path: string[] = [];
  /** Paragraphs before the first heading; `null` once structure is reached. */
  let frontMatter: string[] | null = [];

  const flush = () => {
    if (current.length === 0) return;
    const body = current.join(" ");
    const context = [...path, ...(label ? [label] : [])];
    const header = `[${[title, ...context].join(" — ")}]`;
    subsplit(body).forEach((part, i) => {
      chunks.push({
        docKey,
        articulo: label,
        path: [...path],
        part: i,
        content: `${header} ${part}`,
      });
    });
    current = [];
  };

  /**
   * Resolve the buffered front matter the moment structure begins: emit the
   * preámbulo if there is one, drop the title block either way.
   */
  const flushFrontMatter = () => {
    if (frontMatter === null) return;
    const preamble = preambleOf(frontMatter.join(" "));
    frontMatter = null;
    if (preamble === null) return;
    label = "Preámbulo";
    current = [preamble];
    flush();
    label = null;
  };

  for (const p of normalizeFragments(paragraphs).flatMap(splitInlineHeadings)) {
    const isHeading = isHeadingLine(p);
    const m = isHeading ? null : p.match(ART_RE);
    if (frontMatter !== null) {
      if (!isHeading && !m) {
        frontMatter.push(p);
        continue;
      }
      flushFrontMatter();
    }
    if (isHeading) {
      flush();
      label = null;
      const level = headerLevel(p);
      path = path.filter((h) => headerLevel(h) < level);
      path.push(p);
      continue;
    }
    if (m) {
      flush();
      label = m[1];
    }
    current.push(p);
  }
  if (frontMatter !== null) {
    // A document that never reached a heading has no front matter to strip —
    // it is the unstructured whole-doc case of SPEC §4 rule 4, and dropping
    // its text as boilerplate would leave nothing behind.
    current = frontMatter;
    frontMatter = null;
  }
  flush();

  return chunks;
}

/** The `[Title — Contexto]` prefix `chunkDocument` puts on every chunk. */
const CONTEXT_HEADER_RE = /^\[[^\]]*\]\s*/;

/**
 * Fail unless `chunks` carries text of its own — the belt to the empty-body
 * guard's braces (#206).
 *
 * A chunk set can be non-empty and still hold nothing citable: every path
 * through `chunkDocument` prepends a context header it synthesises from the
 * title, so a run whose extraction recovered no text can still emit chunks
 * that are pure header. Counting chunks does not catch that, and the count is
 * the only thing standing between a broken extraction and a `replace_chunks`
 * that swaps a document's real chunks for nothing.
 */
export function assertChunksCarryContent(
  docKey: string,
  chunks: readonly Chunk[],
): void {
  if (chunks.length === 0) {
    throw new Error(`${docKey}: extraction produced zero chunks`);
  }
  const carries = chunks.some(
    (c) => c.content.replace(CONTEXT_HEADER_RE, "").trim().length > 0,
  );
  if (!carries) {
    throw new Error(
      `${docKey}: extraction produced ${chunks.length} chunk(s) with no ` +
        `content beyond the context header`,
    );
  }
}
