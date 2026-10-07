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
 * Costa Rica's fiscal year is the calendar year, read in Costa Rica time
 * (`cr-time.ts`), so a source turns over at local midnight on 1 January,
 * not UTC's.
 */
import manifest from "../../corpus/manifest.json";
import { crDate } from "./cr-time";

/** The slice of a manifest entry vigencia reads. */
export interface VigenciaEntry {
  doc_key: string;
  effective_date?: string;
  annualChurn?: boolean;
  verifiedForFiscalYear?: number;
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
  const isDecember = crDate(now).slice(5, 7) === "12";

  return {
    uncovered: series.filter((s) => !current.has(s)),
    dueForNextYear: isDecember ? series.filter((s) => !next.has(s)) : [],
    superseded: annual
      .filter(
        (entry) =>
          (lastFiscalYear(entry) ?? -Infinity) < year &&
          current.has(annualSeries(entry.doc_key)),
      )
      .map((entry) => entry.doc_key),
  };
}

/** The doc_keys whose chunks may not ground an answer at a given moment. */
export interface WithheldSources {
  /** `annualChurn` entries that do not cover the current fiscal year. */
  outOfPeriod: ReadonlySet<string>;
  /** The manifest's `retiredDocKeys`. */
  retired: ReadonlySet<string>;
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
 * The drop is by source. A source that is not annual but quotes a year's
 * figure (Ley 7092 as SINALEVI consolidates it) is not caught here; runbook
 * §2.2 has the owner check those by hand.
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
    retired: new Set(source.retiredDocKeys ?? []),
  };
}

export function isWithheld(withheld: WithheldSources, docKey: string): boolean {
  return withheld.outOfPeriod.has(docKey) || withheld.retired.has(docKey);
}
