/**
 * In-document cross-references (#508, ADR 0024): an artículo in the answer set
 * that names a sibling artículo brings that artículo along.
 *
 * Ley IVA art. 30 says «la tarifa referida en el artículo 10 de la presente
 * ley», and art. 10 is where the 13 % is. The rerank pool of 40 cannot be
 * relied on to carry it — for «¿Cuál va a ser la tasa del IVA en 2027?» it
 * was 74th on word match and outside the vector top 50 — so the model read
 * art. 30 and said art. 10 «no está entre los documentos provistos» (#490).
 * The reference itself is the signal, and reading it takes no model call.
 *
 * What counts as a reference to *this* corpus document:
 *
 * - «artículo N de esta ley», «de la presente ley», «de este reglamento» and
 *   the like: the instrument the chunk belongs to. In a reglamento, «ley» is
 *   the law it regulates — the reglamento's own drafting («ambos de la
 *   presente Ley», reglamento-iva art. 1).
 * - a bare «el artículo N» or «referida en el artículo N»: the chunk's own
 *   document.
 * - «artículo N de la Ley» (the defined term), «de la Ley del Impuesto sobre
 *   el Valor Agregado» (its title) or «de la Ley N.° 6826» (its number),
 *   inside a document whose manifest entry declares `regulates`: that law.
 *   The IVA reglamento's art. 22 («de acuerdo a lo establecido en el artículo
 *   10 de la Ley») is how the 2027 question's rerank reaches art. 10.
 *
 * Anything else after the number — «de la Ley N.° 4755», «del Código», «de
 * dicha ley» — names another instrument, and is not followed: resolving it
 * would mean guessing which document it is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import manifest from "../../../corpus/manifest.json";
import type { Database } from "../database.types";
import { modeKnob } from "../knobs";
import { describeError } from "../log-redaction";
import type { DocumentSource, RetrievedChunk } from "../retrieval";
import { serviceClient } from "../supabase/service";
import { isWithheld, withheldSources, type WithheldSources } from "../vigencia";

/**
 * At most this many chunks are appended. Each fragment the model reads is one
 * more it can cite wrongly: #304's `pin` appended up to three and groundedness
 * fell 71 → 67 on fragments cited in the wrong place (ADR 0020). #508 allowed
 * two; the probe measured one (eval/runs/2026-10-07-508/): a second slot
 * filled on 71 of 109 answer sets and brought no expected target any case
 * lacked.
 */
export const CROSS_REFERENCE_CAP = 1;

/**
 * Candidates read from the answer set before the database is asked: a bound
 * on the one query, not on what is appended — a candidate the corpus does
 * not hold gives its place to the next. A set of eight artículos names fewer
 * than this in practice.
 */
const CANDIDATE_LIMIT = 12;

/**
 * The lookup's own budget. It is one indexed read, and the append is
 * optional: past this the ask goes on without it, rather than wait.
 */
export const LOOKUP_TIMEOUT_MS = 2_000;

/** One referenced artículo: its document and its normalized number. */
export interface ArticuloReference {
  docKey: string;
  /** «10», «11 BIS» — `articuloKey` of the label it should match. */
  articulo: string;
  /**
   * The clause defers a figure to it — «la tarifa referida en el artículo
   * 10». Those are read first: a figure the model cannot see is the false
   * «not in the documents» claim #490 found.
   */
  figure?: boolean;
}

/** What `crossReferences` needs to know about the corpus's documents. */
export interface DocumentLink {
  docKey: string;
  /** The title, compared against «de la Ley del …» after the number. */
  title: string;
  norma: string | null;
  /** The doc_key of the law this document regulates, when it is a reglamento. */
  regulates?: string;
}

interface ManifestDocument {
  doc_key: string;
  title: string;
  norma?: string | null;
  regulates?: string;
}

export const DOCUMENT_LINKS: ReadonlyMap<string, DocumentLink> = new Map(
  (manifest.documents as ManifestDocument[]).map((doc) => [
    doc.doc_key,
    {
      docKey: doc.doc_key,
      title: doc.title,
      norma: doc.norma ?? null,
      ...(doc.regulates === undefined ? {} : { regulates: doc.regulates }),
    },
  ]),
);

/** One artículo of one document, as the dedupe and the lookup compare them. */
function referenceKey(docKey: string, articulo: string | null): string {
  return `${docKey}\u0000${articulo ?? ""}`;
}

/** Lowercase, unaccented, single-spaced: how titles and markers compare. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const ORDINALS: Record<string, number> = {
  primero: 1,
  segundo: 2,
  tercero: 3,
  cuarto: 4,
  quinto: 5,
  sexto: 6,
  septimo: 7,
  setimo: 7,
  octavo: 8,
  noveno: 9,
  decimo: 10,
};

const SUFFIXES = ["bis", "ter", "quater", "quinquies"] as const;

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

// One item of a reference list, on folded text: «10», «4°», «1.º», «10 bis»,
// «primero».
const ITEM = new RegExp(
  String.raw`^(?:(\d+)(?: ?\.?[°º])?|(${Object.keys(ORDINALS).join("|")})\b)(?: (${SUFFIXES.join("|")})\b)?`,
);
// Between list items: «, », « y », « e », «, y ».
const SEPARATOR = /^(?: ?, ?(?:y |e )?| y | e )/;
// A subdivision before the instrument: «artículo 1 apartado B) inciso iv) de
// la Ley». Skipped, up to the next «de», so the instrument is still read.
const SUBDIVISION =
  /^,? ?(?:ambos|inciso|incisos|apartado|apartados|aparte|denominado|parrafo|parrafos|numeral|numerales|subinciso|subincisos|literal)\b(?:[^.;:]|\.(?=\d)){0,80}?(?= del? )/;

// The words before a reference that say it defers a figure: «la tarifa
// referida en el artículo 10», «el porcentaje a que se refiere el artículo
// 29». Read on the clause before the reference, up to the last sentence or
// clause break.
const FIGURE_WORDS =
  /\b(?:tarifa|tarifas|tasa|tasas|porcentaje|porcentajes|monto|montos|cuota|cuotas|escala|tramo|tramos|base imponible|base minima)\b[^.;:]{0,80}$/;

// SINALEVI's editorial marks, «el artículo 46 (*) de esta Ley».
const EDITORIAL_MARK = /^ ?\(\*+\)/;
const DEFINED_TERM =
  /^de la ley(?:$|[^\p{L}\d ]| (?:y|e|o|u|que|se|en|a|al|el|la|los|las|con|como|cuando|segun|citada|antes|mencionada|indicada|vigente)\b)/u;

/**
 * What the words after the number name: the chunk's own document (`self`),
 * the law of its instrument (`law` — the document itself, or the law a
 * reglamento regulates), or another instrument (`none`). `tail` is folded
 * text starting right after the list.
 */
function classifyTail(
  tail: string,
  regulated: DocumentLink | undefined,
): "self" | "law" | "none" {
  const skipped = tail.match(SUBDIVISION) ?? tail.match(EDITORIAL_MARK);
  if (skipped) return classifyTail(tail.slice(skipped[0].length), regulated);
  // A dash after the number is a heading, «Artículo 5º—Este Decreto…», that
  // a chunk carried over from the next artículo; not a reference.
  if (/^\.?[-—–]/.test(tail)) return "none";
  const rest = tail.replace(/^,? ?/, "");
  // A range («artículos 5 al 9») names artículos the list never spelled out;
  // «el antiguo artículo 72 al actual 87» is a renumbering note.
  if (/^(?:al|a) (?:actual )?\d/.test(rest)) return "none";
  if (/^(?:de esta|de la presente) ley\b/.test(rest)) return "law";
  if (
    /^(?:de este|del presente) (?:reglamento|decreto|codigo|titulo|capitulo)\b/.test(
      rest,
    ) ||
    /^(?:de esta|de la presente) (?:resolucion|norma)\b/.test(rest)
  ) {
    return "self";
  }
  if (regulated !== undefined && /^de la ley\b/.test(rest)) {
    const named = rest.slice("de la ".length);
    if (named.startsWith(fold(titleStem(regulated.title)))) return "law";
    const number = named.match(
      /^ley (?:(?:n|no|nro|numero)\.? ?[°º]?\.? ?)?(\d+)/,
    );
    if (number) {
      return number[1] === lawNumber(regulated.norma) ? "law" : "none";
    }
    // The defined term: «de la Ley» followed by punctuation or by a word
    // that cannot be part of another law's name («de la Ley Reguladora…»).
    return DEFINED_TERM.test(rest) ? "law" : "none";
  }
  if (/^(?:de|del) /.test(rest)) return "none";
  return "self";
}

/** «Ley del Impuesto sobre el Valor Agregado (texto consolidado)» → before «(». */
function titleStem(title: string): string {
  return title.replace(/\s*\(.*$/, "").trim();
}

/** «Ley 6826» → «6826»; a norma that is not a numbered law → null. */
function lawNumber(norma: string | null): string | null {
  return norma?.match(/^Ley (\d+)$/)?.[1] ?? null;
}

/**
 * The artículos a chunk names inside its own document or the law its
 * reglamento regulates, in the order the text names them, each once. The
 * chunk's own artículo is never one of them: its heading repeats it, and so
 * does «el presente artículo» prose that happens to carry the number.
 */
export function crossReferences(
  chunk: Pick<RetrievedChunk, "docKey" | "articulo" | "content"> &
    Partial<Pick<RetrievedChunk, "part">>,
  links: ReadonlyMap<string, DocumentLink> = DOCUMENT_LINKS,
): ArticuloReference[] {
  const regulates = links.get(chunk.docKey)?.regulates;
  const regulated = regulates === undefined ? undefined : links.get(regulates);
  const lawKey = regulated?.docKey ?? chunk.docKey;
  // A preámbulo cites the instrument's legal basis — the Constitution, other
  // laws — in subdivided lists this reading cannot tell apart.
  if (fold(chunk.articulo ?? "").startsWith("preambulo")) return [];
  const own = articuloKey(chunk.articulo);
  // The ingestion header «[title — path — artículo]» repeats the chunk's own
  // label; the body is what makes a reference.
  const body = chunk.content.replace(/^\[[^\]]*\]\s*/, "");
  const folded = fold(body);

  const found = new Map<string, ArticuloReference>();
  for (const match of folded.matchAll(/\barticulos? /g)) {
    let at = match.index + match[0].length;
    const numbers: string[] = [];
    for (;;) {
      const item = folded.slice(at).match(ITEM);
      if (!item) break;
      const n = item[1] ?? String(ORDINALS[item[2]]);
      numbers.push(
        item[3] ? `${Number(n)} ${item[3].toUpperCase()}` : String(Number(n)),
      );
      at += item[0].length;
      const separator = folded.slice(at).match(SEPARATOR);
      if (!separator || !ITEM.test(folded.slice(at + separator[0].length))) {
        break;
      }
      at += separator[0].length;
    }
    if (numbers.length === 0) continue;
    // A first part that opens on its own artículo heading names nothing; a
    // later part opening on «artículo 4 de esta ley…» does.
    if (match.index === 0 && (chunk.part ?? 0) === 0) continue;
    const target = classifyTail(folded.slice(at), regulated);
    if (target === "none") continue;
    const docKey = target === "self" ? chunk.docKey : lawKey;
    const clause = folded.slice(Math.max(0, match.index - 120), match.index);
    const figure = FIGURE_WORDS.test(clause);
    for (const articulo of numbers) {
      if (docKey === chunk.docKey && articulo === own) continue;
      const key = referenceKey(docKey, articulo);
      const earlier = found.get(key);
      // Named twice, once deferring a figure: it keeps its first place and
      // the figure's precedence.
      if (earlier !== undefined) {
        if (figure) earlier.figure = true;
        continue;
      }
      found.set(
        key,
        figure ? { docKey, articulo, figure } : { docKey, articulo },
      );
    }
  }
  return [...found.values()];
}

/**
 * Looks referenced artículos up in the corpus: the first part of each — the
 * one that carries the heading and the rule's opening — that it holds. A
 * seam so tests need no database.
 */
export type ArticuloLookup = (
  references: readonly ArticuloReference[],
  signal?: AbortSignal,
) => Promise<RetrievedChunk[]>;

/** The `chunks` ⋈ `documents` row the lookup selects. */
interface ArticuloRow {
  id: string;
  articulo: string | null;
  path: string[] | null;
  part: number;
  content: string;
  documents: {
    doc_key: string;
    title: string;
    norma: string | null;
    source: unknown;
    effective_date: string | null;
    fetched_at: string | null;
  };
}

/**
 * The production lookup: one service-role read of `chunks` joined to
 * `documents`, no RPC — the role already reads both tables (least privilege,
 * #123, grants nothing to anyone else). Labels are matched loosely in SQL —
 * «art_culo 10» covers «Artículo», «ARTICULO», «ARTÍCULO», «art_culo 10_»
 * the ordinal sign, «q__t_r» the accent of «quáter» — and exactly here,
 * through `articuloKey`.
 */
export function articuloLookup(
  client: Pick<SupabaseClient<Database>, "from"> = serviceClient(),
): ArticuloLookup {
  return async (references, signal) => {
    if (references.length === 0) return [];
    const docKeys = [...new Set(references.map((r) => r.docKey))];
    const patterns = [
      ...new Set(
        references.flatMap(({ articulo }) => {
          const [number, suffix] = articulo.toLowerCase().split(" ");
          return suffix === undefined
            ? [`art_culo ${number}`, `art_culo ${number}_`]
            : [`art_culo ${number} ${suffix.replace(/[aeiou]/g, "_")}`];
        }),
      ),
    ];
    let query = client
      .from("chunks")
      .select(
        "id, articulo, path, part, content, documents!inner(doc_key, title, norma, source, effective_date, fetched_at)",
      )
      .in("documents.doc_key", docKeys)
      .eq("part", 0)
      .or(patterns.map((pattern) => `articulo.ilike."${pattern}"`).join(","));
    if (signal !== undefined) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new CrossReferenceLookupError(error);
    const rows = (data ?? []) as unknown as ArticuloRow[];
    return rows
      .map(toChunk)
      .filter((chunk) =>
        references.some((reference) => namedBy(chunk, reference)),
      );
  };
}

/** The lookup failing, with the driver's error as `cause` (#136). */
export class CrossReferenceLookupError extends Error {
  constructor(cause: unknown) {
    super("cross-reference lookup failed", { cause });
    this.name = "CrossReferenceLookupError";
  }
}

/** Whether a chunk is the first part of the artículo a reference names. */
function namedBy(chunk: RetrievedChunk, reference: ArticuloReference): boolean {
  return (
    chunk.part === 0 &&
    chunk.docKey === reference.docKey &&
    articuloKey(chunk.articulo) === reference.articulo
  );
}

function toChunk(row: ArticuloRow): RetrievedChunk {
  return {
    chunkId: row.id,
    docKey: row.documents.doc_key,
    docTitle: row.documents.title,
    norma: row.documents.norma,
    articulo: row.articulo,
    path: row.path ?? [],
    part: row.part,
    content: row.content,
    source: (row.documents.source ?? {}) as DocumentSource,
    effectiveAt: row.documents.effective_date,
    fetchedAt: row.documents.fetched_at,
    // No search ranked it: it is here because a ranked chunk named it.
    score: 0,
    vectorRank: null,
    lexicalRank: null,
  };
}

/**
 * Whether references are followed. Unset and empty mean on, like every mode
 * knob (knobs.ts); `off` is the measured baseline the probe compares against.
 */
export function crossReferencesEnabled(): boolean {
  return crossReferenceKnob() === "on";
}

const crossReferenceKnob = modeKnob(
  "PIN_CROSS_REFERENCES",
  ["on", "off"],
  "on",
);

/** The stable prefix of the one line a failed lookup logs (docs/runbook.md). */
export const CROSS_REFERENCE_LOG_PREFIX = "cross-references: lookup failed";

export interface CrossReferenceOptions {
  /** Omit for the service-role lookup; tests hand in a fake. */
  lookup?: ArticuloLookup;
  links?: ReadonlyMap<string, DocumentLink>;
  /** Defaults to what `retrieve()` withholds now (#505). */
  withheld?: WithheldSources;
  /** The ask's own cancellation; the lookup adds `LOOKUP_TIMEOUT_MS`. */
  signal?: AbortSignal;
}

/**
 * The chunks the answer set's references bring, at most
 * `CROSS_REFERENCE_CAP`: a reference that defers a figure first («la tarifa
 * referida en el artículo 10»), then the order the set names them — the
 * set's own order, then each chunk's text order. Only the set the rerank cut
 * is read, never what this appends, so one reference cannot chain into the
 * next. An artículo already in the set — any part of it — is not fetched
 * again, and one whose label the document repeats (`reglamento-iva` has two
 * «Artículo 25») is not appended at all: which one was meant is a guess.
 *
 * A lookup that fails or runs out of time costs the append and nothing else:
 * the answer set the rerank chose is still a complete one, so the failure is
 * logged, never thrown.
 */
export async function crossReferencedChunks(
  answerSet: readonly RetrievedChunk[],
  options: CrossReferenceOptions = {},
): Promise<RetrievedChunk[]> {
  if (!crossReferencesEnabled()) return [];
  const withheld = options.withheld ?? withheldSources();
  const present = new Set(
    answerSet.map((chunk) =>
      referenceKey(chunk.docKey, articuloKey(chunk.articulo)),
    ),
  );
  const candidates = new Map<string, ArticuloReference>();
  for (const chunk of answerSet) {
    for (const reference of crossReferences(chunk, options.links)) {
      const key = referenceKey(reference.docKey, reference.articulo);
      if (present.has(key) || isWithheld(withheld, reference.docKey)) continue;
      const earlier = candidates.get(key);
      if (earlier === undefined) candidates.set(key, { ...reference });
      else if (reference.figure) earlier.figure = true;
    }
  }
  // A reference that defers a figure first, then the set's order (a stable
  // sort keeps it within each group).
  const ranked = [...candidates.values()]
    .sort((a, b) => Number(b.figure ?? false) - Number(a.figure ?? false))
    .slice(0, CANDIDATE_LIMIT);
  if (ranked.length === 0) return [];

  let fetched: RetrievedChunk[];
  try {
    const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    fetched = await (options.lookup ?? articuloLookup())(
      ranked,
      options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    );
  } catch (error) {
    console.warn(`${CROSS_REFERENCE_LOG_PREFIX} error=${describeError(error)}`);
    return [];
  }

  const appended: RetrievedChunk[] = [];
  for (const reference of ranked) {
    if (appended.length === CROSS_REFERENCE_CAP) break;
    const named = fetched.filter((chunk) => namedBy(chunk, reference));
    if (named.length === 1) appended.push(named[0]);
  }
  return appended;
}
