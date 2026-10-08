/**
 * Fiscal-year vigencia for the annual corpus (ADR 0016, #262, #505).
 *
 * Six manifest sources state figures that change with the fiscal year — the
 * renta tramos, the salario base, the salarios mínimos, both CCSS escalas and
 * the BMC mechanism — and carry `annualChurn`. A successful fetch proves the
 * text is still online, not that its figure is still the one in force, so
 * each of those entries says which fiscal years it vouches for, and this
 * module is the one reading of that: the manifest vigencia test gates the
 * manifest on it, and `retrieve()` withholds every chunk whose annual source
 * does not cover the year the question is asked in.
 *
 * Some sources that are not annual still quote one year's figures — the
 * consolidated Ley 7092 carries the year's tramos and créditos in its
 * artículos 15, 33 and 34 — so an entry can also list, as `yearFigures`, the
 * artículos that state one fiscal year's figures. `retrieve()` withholds
 * those chunks outside that year, and leaves the rest of the source alone
 * (#518).
 *
 * Costa Rica's fiscal year is the calendar year, read in Costa Rica time
 * (`cr-time.ts`), so a source turns over at local midnight on 1 January,
 * not UTC's.
 */
import manifest from "../../corpus/manifest.json";
import { crDate } from "./cr-time";

/**
 * One artículo of a source that is not annual but states one fiscal year's
 * figures (#518). Its chunks ground answers in that year only.
 */
export interface YearFigure {
  /** The chunk heading, exactly as the chunker writes it (`chunks.articulo`). */
  articulo: string;
  /** The fiscal year whose figures the artículo states. */
  fiscalYear: number;
  /**
   * Words of the source that tie the artículo to `fiscalYear` — the decree
   * note, the image's heading. Every chunk of the artículo must carry them:
   * ingestion refuses a crawl in which one does not, and `retrieve()`
   * withholds one that does not, so the year cannot be advanced without the
   * text, nor the text without the year.
   */
  evidence: string;
  /** Which figures, for whoever reads the manifest. */
  figures?: string;
}

/** The slice of a manifest entry vigencia reads. */
export interface VigenciaEntry {
  doc_key: string;
  effective_date?: string;
  annualChurn?: boolean;
  verifiedForFiscalYear?: number;
  yearFigures?: readonly YearFigure[];
}

export interface VigenciaManifest {
  documents: readonly VigenciaEntry[];
  retiredDocKeys?: readonly string[];
}

const MANIFEST: VigenciaManifest = manifest;

/** The Costa Rican fiscal year `now` falls in. */
export function crFiscalYear(now = new Date()): number {
  return Number(crDate(now).slice(0, 4));
}

/** Whether `now` falls in December, Costa Rica time: the warning month. */
function isDecember(now: Date): boolean {
  return crDate(now).slice(5, 7) === "12";
}

/** The year an entry's figure took effect; `null` when it names none. */
function firstFiscalYear(entry: VigenciaEntry): number | null {
  const year = Number(entry.effective_date?.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

/**
 * The last fiscal year an entry vouches for: the year it was re-verified for
 * when an unchanged older rule was checked again (`verifiedForFiscalYear`),
 * its own effective year otherwise. `null` when it names no year at all.
 */
function lastFiscalYear(entry: VigenciaEntry): number | null {
  const year = entry.verifiedForFiscalYear ?? firstFiscalYear(entry);
  return Number.isInteger(year) ? year : null;
}

/**
 * Whether an entry vouches for `year`: from the year its figure took effect
 * through its last verified year. An entry naming no year vouches for none —
 * a missing freshness input fails closed (ADR 0016). One without an
 * `effective_date` but with a verified year (the BMC mechanism) is open at
 * the start, since nothing says when it began. Coverage is in whole years:
 * a source that takes effect mid-year joins the manifest when it does
 * (runbook §2.2).
 */
export function coversFiscalYear(entry: VigenciaEntry, year: number): boolean {
  const last = lastFiscalYear(entry);
  if (last === null || year > last) return false;
  const first = firstFiscalYear(entry);
  return first === null || first <= year;
}

/**
 * The annual series an entry belongs to: its doc_key without a trailing year.
 * `tramos-renta-2026` and `tramos-renta-2027` are one series, so next year's
 * source can be ingested beside this year's in December and take over on
 * 1 January with no deploy that day.
 */
export function annualSeries(docKey: string): string {
  return docKey.replace(/-\d{4}$/, "");
}

export interface AnnualVigencia {
  /** Series with no entry covering the current fiscal year — a release gate. */
  uncovered: string[];
  /**
   * From 1 December only: series with no entry covering the next fiscal year
   * yet, so on 1 January they would be withheld.
   */
  dueForNextYear: string[];
  /**
   * Doc_keys, not series: entries past their last covered year whose series
   * another entry now covers. `retrieve()` already withholds them; they are
   * waiting to be retired. An entry past its year with no successor is not
   * listed here: its series is `uncovered`, and the fix is a review, not a
   * retirement.
   */
  superseded: string[];
}

/** The manifest's annual series, read against the fiscal year of `now`. */
export function annualVigencia(
  source: VigenciaManifest = MANIFEST,
  now = new Date(),
): AnnualVigencia {
  const year = crFiscalYear(now);
  const annual = source.documents.filter((entry) => entry.annualChurn);
  const series = [...new Set(annual.map((e) => annualSeries(e.doc_key)))];
  const coveredIn = (y: number) =>
    new Set(
      annual
        .filter((entry) => coversFiscalYear(entry, y))
        .map((entry) => annualSeries(entry.doc_key)),
    );
  const current = coveredIn(year);
  const next = coveredIn(year + 1);

  return {
    uncovered: series.filter((s) => !current.has(s)),
    dueForNextYear: isDecember(now) ? series.filter((s) => !next.has(s)) : [],
    superseded: annual
      .filter(
        (entry) =>
          (lastFiscalYear(entry) ?? -Infinity) < year &&
          current.has(annualSeries(entry.doc_key)),
      )
      .map((entry) => entry.doc_key),
  };
}

/** A manifest `yearFigures` entry, named the way a warning reads it. */
export interface YearFigureRef {
  docKey: string;
  articulo: string;
  fiscalYear: number;
  evidence: string;
}

/** `docKey · articulo (fiscalYear)`. */
export function yearFigureLabel(ref: YearFigureRef): string {
  return `${ref.docKey} · ${ref.articulo} (${ref.fiscalYear})`;
}

/** Every `yearFigures` artículo in a manifest, with its source's doc_key. */
export function yearFigureRefs(source: VigenciaManifest): YearFigureRef[] {
  return source.documents.flatMap((entry) =>
    (entry.yearFigures ?? []).map(({ articulo, fiscalYear, evidence }) => ({
      docKey: entry.doc_key,
      articulo,
      fiscalYear,
      evidence,
    })),
  );
}

/** Whether an artículo's figures are the current fiscal year's. */
function isCurrentYear(ref: YearFigureRef, year: number): boolean {
  return ref.fiscalYear === year;
}

export interface YearFigureVigencia {
  /**
   * Artículos still on a past year's figures: `retrieve()` withholds them
   * until the publisher's text moves to this year and the owner re-crawls
   * it. A warning, not a gate — the fix waits on SINALEVI or the CCSS, and
   * the runtime already keeps the stale figure out of answers. One already
   * on next year's figures is withheld too, but only until 1 January, and
   * asks nothing of anyone, so it is not listed.
   */
  withheld: YearFigureRef[];
  /** From 1 December only: artículos that 1 January will withhold. */
  dueForNextYear: YearFigureRef[];
}

/** The manifest's `yearFigures`, read against the fiscal year of `now`. */
export function yearFigureVigencia(
  source: VigenciaManifest = MANIFEST,
  now = new Date(),
): YearFigureVigencia {
  const year = crFiscalYear(now);
  const refs = yearFigureRefs(source);
  return {
    withheld: refs.filter((ref) => ref.fiscalYear < year),
    dueForNextYear: isDecember(now)
      ? refs.filter((ref) => !isCurrentYear(ref, year + 1))
      : [],
  };
}

/** What may not ground an answer at a given moment. */
export interface WithheldSources {
  /** `annualChurn` entries that do not cover the current fiscal year. */
  outOfPeriod: ReadonlySet<string>;
  /**
   * Every `yearFigures` artículo, keyed by `yearFigureKey`: whether its
   * declared year is the current one, and the evidence a chunk of it must
   * carry to be served (#518).
   */
  yearFigures: ReadonlyMap<string, { current: boolean; evidence: string }>;
  /** The manifest's `retiredDocKeys`. */
  retired: ReadonlySet<string>;
}

/** The chunk identity `yearFigures` is keyed by. */
function yearFigureKey(docKey: string, articulo: string | null): string {
  return `${docKey}\u0000${articulo ?? ""}`;
}

/**
 * What `retrieve()` withholds in the fiscal year of `now`. A chunk from an
 * `annualChurn` source that does not cover that year is dropped, never
 * tagged: ADR 0016 says such a source cannot make an answer eligible, and a
 * dropped chunk is a guarantee the model cannot quote it as current, where a
 * tag would only be an instruction it might not follow (#505). A retired
 * doc_key is dropped too: retiring last year's source from the manifest
 * deploys before the ingest that deletes its rows runs, and in between the
 * runtime would no longer know it was annual. Every other source passes,
 * including a doc_key the manifest does not list — a test fixture, or a
 * document ingested by a newer manifest than the one deployed.
 *
 * A source that is not annual but quotes a year's figures is withheld by
 * artículo instead: each `yearFigures` artículo is dropped in every fiscal
 * year but its own, for the same reason and with the same guarantee (#518).
 * The rest of the source still grounds answers.
 *
 * Unlike an annual source, such an artículo keeps one doc_key across years,
 * so the manifest that names its year and the rows that hold its text are
 * deployed at different moments: a year bump merges before the production
 * re-crawl can run (`scripts/recrawl.sh` crawls only origin/main), and a
 * re-crawl can land a new year's text before the bump. So a chunk is served
 * only while its declared year is current **and** its own text carries the
 * declared evidence: in either window the two disagree, and it is withheld.
 */
export function withheldSources(
  now = new Date(),
  source: VigenciaManifest = MANIFEST,
): WithheldSources {
  const year = crFiscalYear(now);
  return {
    outOfPeriod: new Set(
      source.documents
        .filter((entry) => entry.annualChurn && !coversFiscalYear(entry, year))
        .map((entry) => entry.doc_key),
    ),
    yearFigures: new Map(
      yearFigureRefs(source).map((ref) => [
        yearFigureKey(ref.docKey, ref.articulo),
        { current: isCurrentYear(ref, year), evidence: ref.evidence },
      ]),
    ),
    retired: new Set(source.retiredDocKeys ?? []),
  };
}

/**
 * Whether anything is withheld for being out of period. A listed artículo
 * whose text and declaration disagree is not counted: that is the brief
 * window around a re-crawl, and it costs at most a few of the pool's places.
 */
export function withholdsAny(withheld: WithheldSources): boolean {
  return (
    withheld.outOfPeriod.size > 0 ||
    [...withheld.yearFigures.values()].some((figure) => !figure.current)
  );
}

/**
 * Whether a chunk may not ground an answer: by source, or — for a
 * `yearFigures` artículo — by its declared year and its own text.
 */
export function isWithheld(
  withheld: WithheldSources,
  chunk: { docKey: string; articulo: string | null; content: string },
): boolean {
  if (
    withheld.outOfPeriod.has(chunk.docKey) ||
    withheld.retired.has(chunk.docKey)
  ) {
    return true;
  }
  const figure = withheld.yearFigures.get(
    yearFigureKey(chunk.docKey, chunk.articulo),
  );
  return (
    figure !== undefined &&
    (!figure.current || !chunk.content.includes(figure.evidence))
  );
}
