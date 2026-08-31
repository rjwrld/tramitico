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
const HDR_RE =
  /^(T[ÍI]TULO|T[íi]tulo|CAP[ÍI]TULO|Cap[íi]tulo|SECCI[ÓO]N|Secci[óo]n)\b/;

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
// nor HDR_RE ever sees a whole heading. Rejoin those fragments first.
const FRAG_ART_WORD_RE = /^(ART[ÍI]CULO|Art[íi]culo|TRANSITORIO|Transitorio)$/;
const FRAG_HDR_WORD_RE =
  /^(T[ÍI]TULO|T[íi]tulo|CAP[ÍI]TULO|Cap[íi]tulo|SECCI[ÓO]N|Secci[óo]n)$/;
const FRAG_NUM_START_RE = /^(\d|[IVXLCDM]+\b)/;
/** Short all-caps caption line continuing a fragmented header. */
const FRAG_CAPTION_RE = /^[^a-záéíóúñ]{1,60}$/;

export function normalizeFragments(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    let p = paragraphs[i];
    const next = paragraphs[i + 1];
    if (FRAG_ART_WORD_RE.test(p) && next && FRAG_NUM_START_RE.test(next)) {
      p = `${p} ${paragraphs[++i]}`;
    } else if (
      FRAG_HDR_WORD_RE.test(p) &&
      next &&
      FRAG_NUM_START_RE.test(next)
    ) {
      p = `${p} ${paragraphs[++i]}`;
      for (
        let absorbed = 0;
        absorbed < 3 &&
        i + 1 < paragraphs.length &&
        FRAG_CAPTION_RE.test(paragraphs[i + 1]) &&
        !/DECRETA/.test(paragraphs[i + 1]) &&
        !FRAG_ART_WORD_RE.test(paragraphs[i + 1]) &&
        !FRAG_HDR_WORD_RE.test(paragraphs[i + 1]);
        absorbed++
      ) {
        p = `${p} ${paragraphs[++i]}`;
      }
    }
    out.push(p);
  }
  return out;
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
  let sawArticulo = false;

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

  for (const p of normalizeFragments(paragraphs).flatMap(splitInlineHeadings)) {
    if (label === null && !sawArticulo && /DECRETA/.test(p.toUpperCase())) {
      flush();
      label = "Preámbulo";
      current.push(p);
      continue;
    }
    if (HDR_RE.test(p) && p.split(" ").length < 15) {
      flush();
      label = null;
      const level = headerLevel(p);
      path = path.filter((h) => headerLevel(h) < level);
      path.push(p);
      continue;
    }
    const m = p.match(ART_RE);
    if (m) {
      flush();
      label = m[1];
      sawArticulo = true;
    }
    current.push(p);
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
