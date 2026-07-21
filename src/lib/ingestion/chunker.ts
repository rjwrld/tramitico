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
const HDR_RE = /^(T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N)\b/i;

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

export function chunkDocument(
  docKey: string,
  title: string,
  paragraphs: string[],
): Chunk[] {
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

  for (const p of paragraphs) {
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
