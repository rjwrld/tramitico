/**
 * False corpus-absence claims (#500): a deterministic check, no model.
 *
 * The answer model sees up to nine fragments and still writes sentences about
 * the corpus as a whole: «la ley remite a la tarifa general del artículo 10,
 * que los documentos provistos no reproducen». Ley IVA art. 10 *is* ingested;
 * it just was not among the fragments. Every judge sees the same fragments the
 * model saw, so every judge agrees, and five committed transcripts scored the
 * sentence a pass. What can tell the claim false is the one artefact that
 * knows the whole corpus: `eval/corpus-index.json`.
 *
 * So the check is narrow on purpose. A sentence counts only when it
 *
 * - is an absence claim about the corpus — «los documentos no traen…», «…no
 *   está entre las fuentes», «ninguno de los documentos menciona…», a «Sobre
 *   X,» topic in front of one; and
 * - names, as the thing absent, an artículo of a document this module can
 *   resolve, or one of a closed list of figures (`FIGURES`); and
 * - the corpus index covers that artículo or that figure.
 *
 * A sentence that says the documents do not *say something about* an artículo
 * («no precisan cómo se cuenta la multa del artículo 79») is not a claim that
 * the artículo is missing, and is left alone: the artículo has to be the head
 * of what is said to be absent. A figure qualified by a year the corpus does
 * not carry («ninguna tarifa del IVA para 2027») is the honest abstention the
 * prompt asks for, and is left alone too. The detector prefers a miss to a
 * false alarm: it gates the lanes, and #500's backtest is its precision read.
 *
 * Separately, an answer whose *opening* sentence is any absence claim is
 * reported (rule 6 says «no la empiece diciendo que no encuentra base
 * oficial»), true or false, never gated.
 */
import committedIndex from "../../../eval/corpus-index.json";
import { citationMarkers } from "../answer/citations";
import type { CorpusIndex } from "./corpus-index";

/** What the corpus index covers, in the shape the detector reads it. */
export interface CorpusCoverage {
  /** docKey → the artículo numbers ingested for it (`articuloNumber`). */
  readonly articulos: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface FalseAbsence {
  /** The sentence, as the answer wrote it. */
  sentence: string;
  /** What it says is absent: `ley-iva · Artículo 10`, or a figure's label. */
  target: string;
}

export interface AbsenceReport {
  /** Absence claims the corpus index contradicts. The lanes gate on these. */
  falseClaims: FalseAbsence[];
  /** The opening sentence when it is an absence claim, true or false. */
  opening: string | null;
}

/** A chunk the answer cited; only its document is read. */
export interface CitedChunk {
  docKey: string;
}

/**
 * Lowercase, accents stripped. Every pattern below is written against this
 * form, so «Artículo», «ARTICULO» and «artículo» are one string, and `\b`
 * works (it is ASCII-only, and «está» would otherwise have no boundary).
 */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const SUFFIX = "bis|ter|quater|quinquies|sexies";

/**
 * The number an artículo label carries, normalized: «Artículo 10» → `10`,
 * «ARTICULO 2» → `2`, «Articulo 38 quater» → `38 quater`, «Artículo 4°,
 * sesión 9570» → `4`. `null` for a label that is no numbered artículo
 * (`Preámbulo`, `TRANSITORIO I`, a FAQ question).
 */
export function articuloNumber(label: string): string | null {
  const match = new RegExp(
    `^art(?:iculo|\\.)\\s*(\\d+)(?:\\s*[°º])?(?:\\s+(${SUFFIX}))?\\b`,
  ).exec(fold(label).trim());
  if (match === null) return null;
  return match[2] === undefined ? match[1] : `${match[1]} ${match[2]}`;
}

export function corpusCoverage(index: CorpusIndex): CorpusCoverage {
  const articulos = new Map<string, Set<string>>();
  for (const entry of index.entries) {
    const numbers = articulos.get(entry.docKey) ?? new Set<string>();
    const number =
      entry.articulo === null ? null : articuloNumber(entry.articulo);
    if (number !== null) numbers.add(number);
    articulos.set(entry.docKey, numbers);
  }
  return { articulos };
}

/**
 * The coverage of the committed index. Bundled, like the step catalogue, so
 * the route reads the same corpus the lanes and the backtest do. Production
 * runs main's corpus, and `pnpm ingest` rewrites the file whenever coverage
 * changes (#163).
 */
export const COMMITTED_COVERAGE: CorpusCoverage = corpusCoverage(
  committedIndex satisfies CorpusIndex,
);

type DocKind = "ley" | "reglamento" | "codigo";

/**
 * The documents an artículo mention can be resolved to, by the names answers
 * give them. Reglamentos come first: «Reglamento de la Ley del Impuesto sobre
 * la Renta» contains the ley's name, and `namedDocs` blanks each match out
 * before the next pattern reads the text.
 */
export const ARTICULO_DOCS: readonly {
  docKey: string;
  kind: DocKind;
  name: RegExp;
}[] = [
  {
    docKey: "reglamento-iva",
    kind: "reglamento",
    name: /reglamento (?:de la ley )?del (?:impuesto (?:sobre el|al) valor agregado|iva)\b/g,
  },
  {
    docKey: "reglamento-renta",
    kind: "reglamento",
    name: /reglamento (?:de la ley )?(?:del impuesto sobre la renta|de(?:l)? (?:impuesto de )?renta)\b/g,
  },
  {
    docKey: "reglamento-comprobantes",
    kind: "reglamento",
    name: /reglamento de comprobantes electronicos/g,
  },
  {
    docKey: "reglamento-rts",
    kind: "reglamento",
    name: /reglamento del regimen (?:especial )?de tributacion simplificada/g,
  },
  {
    docKey: "ccss-reglamento-ti",
    kind: "reglamento",
    name: /reglamento (?:para (?:el )?aseguramiento contributivo|(?:de|para) (?:la afiliacion de )?(?:los )?trabajadores independientes)/g,
  },
  {
    docKey: "ley-iva",
    kind: "ley",
    name: /ley (?:del|de) (?:impuesto (?:sobre el|al) valor agregado|iva)\b|ley (?:n\.?[°º]? ?)?6826\b/g,
  },
  {
    docKey: "ley-renta",
    kind: "ley",
    name: /ley (?:del|de) (?:impuesto sobre la )?renta\b|ley (?:n\.?[°º]? ?)?7092\b/g,
  },
  {
    docKey: "ley-10363",
    kind: "ley",
    name: /ley del trabajador independiente|ley (?:n\.?[°º]? ?)?10363\b/g,
  },
  {
    docKey: "cnpt",
    kind: "codigo",
    name: /codigo de normas y procedimientos tributarios|\bcnpt\b|codigo tributario/g,
  },
];

/** The document whose name `text` (folded) starts with, if any. */
function docAt(text: string): string | null {
  for (const doc of ARTICULO_DOCS) {
    if (new RegExp(doc.name.source).exec(text)?.index === 0) return doc.docKey;
  }
  return null;
}

/** The documents `text` (folded) names, each once, in table order. */
function namedDocs(text: string): string[] {
  let rest = text;
  const named: string[] = [];
  for (const doc of ARTICULO_DOCS) {
    let found = false;
    rest = rest.replace(doc.name, (match) => {
      found = true;
      return " ".repeat(match.length);
    });
    if (found) named.push(doc.docKey);
  }
  return named;
}

/**
 * The closed list of figures whose absence the detector checks. Each names
 * the coverage it needs — a document, or one artículo of one — and the years
 * the corpus carries it for: a claim about a year outside them is honest.
 */
export const FIGURES: readonly {
  label: string;
  pattern: RegExp;
  requires: readonly { docKey: string; articulo?: string }[];
  years: readonly number[] | null;
}[] = [
  {
    label: "tarifa general del IVA",
    pattern:
      /tarifa general|tarifas? del (?:iva|impuesto(?! sobre la renta)(?: (?:sobre el|al) valor agregado)?)\b/,
    requires: [{ docKey: "ley-iva", articulo: "10" }],
    years: [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
  },
  {
    label: "BMC",
    pattern: /\bbmc\b|\bbase minima\b/,
    // Derived since #287 from the escala and the wage decree: the manifest
    // tells `ccss-bmc` never to be cited for an amount.
    requires: [
      { docKey: "ccss-escala-ivm" },
      { docKey: "ccss-escala-salud" },
      { docKey: "salarios-minimos" },
    ],
    years: [2026],
  },
  {
    label: "escala contributiva",
    pattern: /\bescalas?\b(?! de (?:renta|tramos))/,
    requires: [{ docKey: "ccss-escala-ivm" }, { docKey: "ccss-escala-salud" }],
    years: [2026],
  },
  {
    label: "salario base",
    pattern: /\bsalario base\b/,
    requires: [{ docKey: "salario-base-2026" }],
    years: [2026],
  },
  {
    label: "salario mínimo",
    pattern: /\bsalarios? minimos?\b/,
    requires: [{ docKey: "salarios-minimos" }],
    years: [2026],
  },
  {
    label: "CABYS",
    pattern: /\bcabys\b|catalogo de bienes y servicios/,
    requires: [{ docKey: "cabys-dev" }],
    years: null,
  },
  {
    label: "tramos de renta",
    pattern: /\btramos\b/,
    requires: [{ docKey: "tramos-renta-2026" }],
    years: [2026],
  },
];

// ── the absence constructions ─────────────────────────────────────────────

const CORPUS = String.raw`(?:documentos|fuentes|fragmentos|textos)`;
const ABSENT_VERB = String.raw`(?:traen|trae|contienen|contiene|incluyen|incluye|reproducen|reproduce|recogen|recoge|transcriben|transcribe)`;
/**
 * Verbs that say the documents do not *state* something. «No indican el monto
 * del salario base» claims the amount absent; «no precisan cómo se cuenta la
 * multa del artículo 79» does not claim the artículo absent, and `HEAD` is
 * what tells the two apart.
 */
const STATE_VERB = String.raw`(?:indican|indica|detallan|detalla|precisan|precisa|especifican|especifica)`;

/** «los documentos … no traen X»; the subject anywhere earlier in the sentence. */
const SUBJECT_VERB = new RegExp(
  String.raw`\b${CORPUS}\b.*?\b(?:no|tampoco)\s+(?:me\s+|le\s+)?(?:${ABSENT_VERB}|${STATE_VERB})\b`,
  "g",
);
/**
 * «no encuentro X» / «no tengo X» / «no hay X», in a sentence about the
 * corpus: the documents are where the speaker looked.
 */
const FIRST_PERSON = /\bno\s+(?:encuentro|tengo|cuento con|hay)\b/g;
/** «no encuentro en los documentos oficiales …»: where, not what. */
const LOCATIVE = new RegExp(
  String.raw`^(?:(?:en|entre|dentro de)\s+(?:los|las|estos|estas|esos|esas)\s+${CORPUS}\b(?:\s+(?:oficiales|provistos|provistas|disponibles|consultad[oa]s|proporcionad[oa]s|aportad[oa]s|entregad[oa]s|que\s+\w+(?:\s+disponibles)?))*\s*)`,
);
/** «ninguno de los documentos menciona X». */
const NONE_OF = new RegExp(
  String.raw`\bningun[oa]\s+de\s+(?:los|las)\s+${CORPUS}\b(?:\s+\w+){0,3}?\s+(?:menciona|contiene|trae|incluye|reproduce|recoge|fija|indica|establece|transcribe)\b`,
  "g",
);
/** «X no está entre los documentos». */
const NOT_AMONG = new RegExp(
  String.raw`\bno\s+(?:esta|estan|aparece|aparecen|figura|figuran|viene|vienen)\s+(?:incluid[oa]s?\s+)?(?:en|entre|dentro de)\s+(?:los|las)\s+${CORPUS}\b`,
  "g",
);
/** «…del artículo 10, que los documentos provistos no reproducen». */
const RELATIVE = new RegExp(
  String.raw`,\s*(?:que|el cual|la cual|los cuales|las cuales)\s+(?:los|las)\s+${CORPUS}\b[^,;:]*?\bno\s+(?:me\s+)?${ABSENT_VERB}\b`,
  "g",
);
/** «Sobre la tarifa general, …» — a topic the rest of the sentence is about. */
const TOPIC =
  /^(?:sobre|en cuanto a|respecto (?:a|de)|acerca de|en lo que toca a)\s+([^,:;]+?)(?=,|:|\s+no\s)/;

/** Where an object noun phrase ends. A comma before «ni» or a digit does not. */
const OBJECT_END =
  /[;:([]|\.(?!\w)|,(?!\s*(?:ni\b|\d))|\s(?:asi que|por lo que|porque|pues|pero|sino|ya que|dado que|de modo que|para (?:poder|que|saber|ubicar|calcular|confirmar|decir|indicar))\b/;
/** Where a subject noun phrase starts, read backwards. */
const SUBJECT_START = /[;:]|\b(?:pero|aunque|sino|mientras)\b/g;
const LEADING_SUBORDINATOR =
  /^(?:,\s*)?(?:como|si|aunque|porque|pues|ya que|dado que|y|e)\s+/;

const DETERMINER = String.raw`(?:tod[oa]s?\s+(?:el|la|los|las)|el|la|los|las|un|una|unos|unas|ningun|ninguna|ese|esa|esos|esas|este|esta|estos|estas|su|sus|dicho|dicha)`;
const HEAD_NOUN = String.raw`(?:texto|contenido|redaccion|monto|montos|valor|valores|cifra|cifras|porcentaje|porcentajes|tabla|tablas|detalle|listado|lista|catalogo|dato|datos|informacion|nada|referencia|numero|codigo|codigos|importe|parte|partes)`;
const ADJECTIVE = String.raw`(?:vigentes?|actual(?:es)?|exact[oa]s?|complet[oa]s?|numeric[oa]s?|en colones|unic[oa]s?|actualizad[oa]s?|oficial(?:es)?|concret[oa]s?|especific[oa]s?|integr[oa]s?|mism[oa]s?)`;
const PREPOSITION = String.raw`(?:de la|de los|de las|del|de|sobre|acerca de)`;
const SUBDIVISION = String.raw`(?:(?:inciso|incisos|numeral|parrafo|apartado)\s+\S+\s+(?:del|de la|de los)\s+)`;
/**
 * What may stand in front of the thing said to be absent: «el texto
 * completo del», «el monto vigente de la», «nada sobre el», «el inciso b del
 * numeral 4 del». Anything else in front — «el formulario para pagar la
 * sanción del artículo 78» — makes the artículo incidental, not absent.
 */
const HEAD = new RegExp(
  String.raw`^(?:complet[oa]s?\s+)?(?:${DETERMINER}\s+)?(?:${HEAD_NOUN}(?:\s+${ADJECTIVE})*(?:\s+${PREPOSITION}(?:\s+${DETERMINER})?)?\s+){0,2}${SUBDIVISION}*$`,
);
/** An object that names nothing: «no encuentro base oficial», «no traen nada». */
const BARE_ABSENCE =
  /^(?:base oficial|informacion|nada|datos?)(?:\s+(?:oficial(?:es)?|al respecto|sobre (?:esto|eso|ello|el tema)))?\s*$|^base oficial\b/;
const POSSESSIVE =
  /^sus?\s+(?:porcentaje|texto|contenido|monto|valor|cifra|tarifa)s?\b/;
/**
 * A figure in another version than the corpus's — a future one, a later one,
 * a different one — is not the figure the corpus carries.
 */
const OTHER_VERSION =
  /\b(?:futur[oa]s?|proyectad[oa]s?|programad[oa]s?|proxim[oa]s?|posterior(?:es)?|anterior(?:es)?|distint[oa]s?|nuev[oa]s?|otr[oa]s?|diferentes?)\b/;
const YEAR = /\b(20\d\d)\b/g;

const ORDINALS: Record<string, string> = {
  primero: "1",
  segundo: "2",
  tercero: "3",
  cuarto: "4",
  quinto: "5",
  sexto: "6",
  septimo: "7",
  octavo: "8",
  noveno: "9",
  decimo: "10",
};
const NUMBER = String.raw`\d+(?:\s*[°º])?(?:\s+(?:${SUFFIX}))?`;
const ARTICULO_MENTION = new RegExp(
  String.raw`^art(?:iculos?|s?\.)\s*((?:${NUMBER})(?:\s*(?:,|\by\b|\be\b|\bo\b)\s*(?:${NUMBER}))*|${Object.keys(ORDINALS).join("|")})`,
);

interface Context {
  /** The documents the answer names: where a bare «artículo 10» looks first. */
  answerDocs: readonly string[];
  citedDocs: readonly string[];
  /**
   * The ley and reglamento of the one tax the answer is about, when it is
   * about one: the last resort of a bare «artículo 10 de la ley» in an answer
   * that names no law and cites none (an abstention row carries no chunks).
   */
  topicDocs: readonly string[];
  coverage: CorpusCoverage;
}

function topicDocs(folded: string): string[] {
  const iva = /\biva\b|valor agregado/.test(folded);
  const renta = /\brenta\b/.test(folded);
  if (iva && !renta) return ["ley-iva", "reglamento-iva"];
  if (renta && !iva) return ["ley-renta", "reglamento-renta"];
  return [];
}

/**
 * The artículo an object phrase starts with, resolved to the documents it
 * could belong to, and whether every one of them covers it. A mention that
 * names no law resolves against the documents the answer names and cites;
 * if those disagree about coverage, the claim is not called false.
 */
function articuloTarget(phrase: string, context: Context): string | null {
  const match = ARTICULO_MENTION.exec(phrase);
  if (match === null) return null;
  const numbers =
    ORDINALS[match[1]] === undefined
      ? match[1]
          .split(/\s*(?:,|\by\b|\be\b|\bo\b)\s*/)
          .map((n) => n.replace(/\s*[°º]/, "").replace(/\s+/g, " "))
      : [ORDINALS[match[1]]];
  const after = phrase.slice(match[0].length);
  const of = /^\s*,?\s*(?:de la|del|de)\s+/.exec(after);
  const tail = of === null ? "" : after.slice(of[0].length);
  const named = of === null ? null : docAt(tail);
  let candidates: string[];
  if (named !== null) {
    candidates = [named];
  } else {
    const generic = /^(ley|reglamento|codigo)\b/.exec(tail)?.[1] as
      DocKind | undefined;
    const ofKind = (docKeys: readonly string[]) =>
      docKeys.filter((docKey) => {
        const doc = ARTICULO_DOCS.find((each) => each.docKey === docKey);
        return (
          doc !== undefined && (generic === undefined || doc.kind === generic)
        );
      });
    candidates = ofKind([
      ...new Set([...context.answerDocs, ...context.citedDocs]),
    ]);
    if (candidates.length === 0) candidates = ofKind(context.topicDocs);
  }
  if (candidates.length === 0) return null;
  const covered = numbers.filter((number) =>
    candidates.every((docKey) =>
      context.coverage.articulos.get(docKey)?.has(number),
    ),
  );
  if (covered.length === 0) return null;
  return `${candidates.join("|")} · Artículo ${covered.join(", ")}`;
}

function figureTarget(phrase: string, context: Context): string | null {
  for (const figure of FIGURES) {
    const match = figure.pattern.exec(phrase);
    if (match === null || match.index !== 0) continue;
    if (!figureCovered(figure, context.coverage)) return null;
    return figure.label;
  }
  return null;
}

function figureCovered(
  figure: (typeof FIGURES)[number],
  coverage: CorpusCoverage,
): boolean {
  return figure.requires.every(({ docKey, articulo }) => {
    const numbers = coverage.articulos.get(docKey);
    return (
      numbers !== undefined && (articulo === undefined || numbers.has(articulo))
    );
  });
}

/** A phrase the honest-abstention rule exempts: a year the figure lacks. */
function outsideCorpusYears(phrase: string): boolean {
  if (OTHER_VERSION.test(phrase)) return true;
  const years = [...phrase.matchAll(YEAR)].map((m) => Number(m[1]));
  if (years.length === 0) return false;
  const figure = FIGURES.find((f) => f.pattern.test(phrase));
  if (figure === undefined || figure.years === null) return false;
  return years.some((year) => !figure.years!.includes(year));
}

/** Where an artículo mention or a listed figure starts in `text`, last first. */
function targetPositions(text: string): number[] {
  const positions = [...text.matchAll(/\bart(?:iculos?|s?\.)\s/g)].map(
    (match) => match.index,
  );
  for (const figure of FIGURES) {
    for (const match of text.matchAll(new RegExp(figure.pattern, "g"))) {
      positions.push(match.index);
    }
  }
  return [...new Set(positions)].sort((a, b) => b - a);
}

/**
 * The target `phrase` starts with. `scope` is the stretch the honest-version
 * rule reads — the conjunct, so «la BMC vigente, ni otras obligaciones» is not
 * excused by the «otras» that belongs to the next one.
 */
function targetAt(
  phrase: string,
  context: Context,
  scope: string = phrase,
): string | null {
  if (outsideCorpusYears(scope)) return null;
  return articuloTarget(phrase, context) ?? figureTarget(phrase, context);
}

/** Where «ni», «y» or «o» joins two noun phrases. Not before a digit. */
const CONJUNCTION = /\s*,?\s+(?:ni|y|o)\s+(?!\d)/g;

/** The conjunct of `phrase` that `position` falls in, as [start, end). */
function conjunctAround(phrase: string, position: number): [number, number] {
  let start = 0;
  let end = phrase.length;
  for (const match of phrase.matchAll(CONJUNCTION)) {
    const boundary = match.index + match[0].length;
    if (boundary <= position) start = boundary;
    else if (match.index >= position) {
      end = match.index;
      break;
    }
  }
  return [start, end];
}

/**
 * What a phrase says is absent, if it is a covered artículo or figure that
 * heads its conjunct (`HEAD`): «el procedimiento ni el valor actual de la
 * BMC» claims the BMC absent as much as the procedure. A conjunction inside
 * the target — «Catálogo de Bienes y Servicios» — is not a boundary, because
 * the target is found first and its conjunct read around it.
 */
function phraseTarget(phrase: string, context: Context): string | null {
  for (const position of targetPositions(phrase).reverse()) {
    const [start, end] = conjunctAround(phrase, position);
    if (!HEAD.test(phrase.slice(start, position))) continue;
    const target = targetAt(
      phrase.slice(position),
      context,
      phrase.slice(start, end),
    );
    if (target !== null) return target;
  }
  return null;
}

/** «el listado», «el catálogo de códigos»: an object that is all head. */
function headOnly(object: string): boolean {
  const [start, end] = conjunctAround(object, 0);
  return HEAD.test(`${object.slice(start, end).trim()} `);
}

/**
 * The covered artículo or figure an anaphor points back to — «su
 * porcentaje», «cuyo texto», «…, que los documentos no reproducen»: the last
 * one named in `text`. With `reachEnd`, only one whose phrase runs to the end
 * of `text`, as a relative clause's antecedent does.
 */
function antecedentTarget(
  text: string,
  context: Context,
  { reachEnd = false }: { reachEnd?: boolean } = {},
): string | null {
  for (const position of targetPositions(text)) {
    const phrase = text.slice(position).split(OBJECT_END)[0];
    if (reachEnd && phrase.trim() !== text.slice(position).trim()) continue;
    const target = targetAt(phrase, context);
    if (target !== null) return target;
  }
  return null;
}

function objectAfter(sentence: string, end: number): string {
  const object = sentence.slice(end).trim().replace(LOCATIVE, "");
  return object.split(OBJECT_END)[0].trim();
}

function subjectBefore(sentence: string, start: number): string {
  const before = sentence.slice(0, start);
  let from = 0;
  for (const match of before.matchAll(SUBJECT_START)) {
    from = match.index + match[0].length;
  }
  return before.slice(from).trim().replace(LEADING_SUBORDINATOR, "");
}

/** The covered artículo or figure one folded sentence claims absent, if any. */
function sentenceTarget(
  folded: string,
  previous: string,
  context: Context,
): string | null {
  const objects: string[] = [];
  const verbEnds: number[] = [];
  for (const match of folded.matchAll(SUBJECT_VERB)) {
    verbEnds.push(match.index + match[0].length);
  }
  for (const match of folded.matchAll(NONE_OF)) {
    verbEnds.push(match.index + match[0].length);
  }
  if (new RegExp(String.raw`\b${CORPUS}\b|base oficial`).test(folded)) {
    for (const match of folded.matchAll(FIRST_PERSON)) {
      verbEnds.push(match.index + match[0].length);
    }
  }
  for (const end of verbEnds) {
    const object = objectAfter(folded, end);
    if (POSSESSIVE.test(object)) {
      const target = antecedentTarget(
        `${previous} ${folded.slice(0, end)}`,
        context,
      );
      if (target !== null) return target;
    }
    objects.push(object);
  }
  for (const match of folded.matchAll(NOT_AMONG)) {
    const subject = subjectBefore(folded, match.index);
    const cuyo = /\bcuy[oa]s?\s/.exec(subject);
    if (cuyo !== null && cuyo.index === 0) {
      // «el artículo 10 (… pero cuyo texto no está entre las fuentes)»
      const at = folded.lastIndexOf(cuyo[0], match.index);
      const target = antecedentTarget(folded.slice(0, at), context);
      if (target !== null) return target;
    }
    objects.push(subject);
  }
  for (const match of folded.matchAll(RELATIVE)) {
    // The antecedent is what ends right before the comma.
    const target = antecedentTarget(
      folded.slice(0, match.index).slice(-90),
      context,
      { reachEnd: true },
    );
    if (target !== null) return target;
  }
  // A «Sobre X,» topic is what is absent only when nothing else is named:
  // «Sobre la tarifa general, los documentos no traen su porcentaje», «Sobre
  // el código CABYS no encuentro base oficial», «…no incluyen el catálogo de
  // códigos». «Sobre el CABYS, no detallan cómo buscarlo» names a procedure,
  // and the topic is not what it says is missing.
  const topic = TOPIC.exec(folded);
  if (
    topic !== null &&
    objects.some(
      (object) =>
        POSSESSIVE.test(object) ||
        BARE_ABSENCE.test(object) ||
        headOnly(object),
    )
  ) {
    objects.push(topic[1]);
  }
  for (const object of objects) {
    const target = phraseTarget(object, context);
    if (target !== null) return target;
  }
  return null;
}

/**
 * Sentences, split on terminal punctuation followed by a capital or an
 * opening mark, and on line breaks. «art. 10» does not split: a digit
 * follows the period.
 */
export function sentences(answer: string): string[] {
  return answer
    .split(/\n+|(?<=[.!?])\s+(?=[¿¡«"*(\-–—\p{Lu}])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const OPENING_ABSENCE = new RegExp(
  [
    String.raw`\b${CORPUS}\b.*\bno\s+(?:me\s+|le\s+)?(?:${ABSENT_VERB}|dicen|dice|indican|indica|precisan|fijan|fija|establecen|mencionan|detallan|especifican|permiten|responden)\b`,
    String.raw`\bno\s+(?:encuentro|hay|existe|tengo)\s+(?:una?\s+|ninguna?\s+)?(?:base|fuente|informacion|norma|documento|dato)s?\b`,
    String.raw`\bningun[oa]\s+de\s+(?:los|las)\s+${CORPUS}\b`,
    String.raw`\bninguna\s+fuente\b`,
    NOT_AMONG.source,
  ].join("|"),
);

/**
 * The detector. Pure: the answer, the chunks it cited, and the corpus
 * coverage in; the false claims and the opening out.
 */
export function detectAbsenceClaims(
  answer: string,
  {
    cited,
    coverage,
  }: { cited: readonly CitedChunk[]; coverage: CorpusCoverage },
): AbsenceReport {
  const folded = fold(answer);
  const context: Context = {
    answerDocs: namedDocs(folded),
    citedDocs: [...new Set(cited.map((chunk) => chunk.docKey))],
    topicDocs: topicDocs(folded),
    coverage,
  };
  const falseClaims: FalseAbsence[] = [];
  const all = sentences(answer);
  all.forEach((sentence, i) => {
    const previous = i === 0 ? "" : fold(all[i - 1]);
    const target = sentenceTarget(fold(sentence), previous, context);
    if (target !== null) falseClaims.push({ sentence, target });
  });
  const first = all.find((sentence) => !/^#+\s|^\*\*[^*]+\*\*$/.test(sentence));
  const opening =
    first !== undefined && OPENING_ABSENCE.test(fold(first)) ? first : null;
  return { falseClaims, opening };
}

/**
 * The chunks `answer`'s `[n]` markers cite, out of the numbered list the
 * prompt showed. A marker past the end is the citation invariant's business,
 * not this module's, and is skipped.
 */
export function citedChunks<T extends CitedChunk>(
  answer: string,
  chunks: readonly T[],
): T[] {
  return [...new Set(citationMarkers(answer))].flatMap((marker) =>
    marker >= 1 && marker <= chunks.length ? [chunks[marker - 1]] : [],
  );
}

/** One line per finding, for a lane's console and its failure message. */
export function describeFalseAbsence(id: string, claim: FalseAbsence): string {
  return `${id}: ${claim.target} — «${claim.sentence}»`;
}
