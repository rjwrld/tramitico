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
import { CR_UTC_OFFSET_MS } from "./cr-time";

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
  return new Date(now.getTime() - CR_UTC_OFFSET_MS).getUTCFullYear();
}

/**
 * The last fiscal year an entry vouches for: the year it was re-verified for
 * when an unchanged older rule was checked again (`verifiedForFiscalYear`),
 * its own effective year otherwise. `null` when it names no year at all.
 */
function lastFiscalYear(entry: VigenciaEntry): number | null {
  const year =
    entry.verifiedForFiscalYear ?? Number(entry.effective_date?.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

/**
 * Whether an entry vouches for `year`: from the year its figure took effect
 * through its last verified year. An entry naming no year vouches for none —
 * a missing freshness input fails closed (ADR 0016). One without an
 * `effective_date` but with a verified year (the BMC mechanism) is open at
 * the start, since nothing says when it began.
 */
export function coversFiscalYear(entry: VigenciaEntry, year: number): boolean {
  const last = lastFiscalYear(entry);
  if (last === null || year > last) return false;
  const first = Number(entry.effective_date?.slice(0, 4));
  return !Number.isInteger(first) || first <= year;
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
   * Annual entries whose last covered year has passed. `retrieve()` already
   * withholds them; they are waiting to be retired from the manifest.
   */
  expired: string[];
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
  const isDecember =
    new Date(now.getTime() - CR_UTC_OFFSET_MS).getUTCMonth() === 11;

  return {
    uncovered: series.filter((s) => !current.has(s)),
    dueForNextYear: isDecember ? series.filter((s) => !next.has(s)) : [],
    expired: annual
      .filter((entry) => (lastFiscalYear(entry) ?? -Infinity) < year)
      .map((entry) => entry.doc_key),
  };
}

/**
 * The chunks whose source may ground an answer in the fiscal year of `now`.
 * A chunk from an `annualChurn` source that does not cover that year is
 * dropped, never tagged: ADR 0016 says such a source cannot make an answer
 * eligible, and a dropped chunk is a guarantee the model cannot quote it as
 * current, where a tag would only be an instruction it might not follow
 * (#505). A `retiredDocKeys` entry is dropped too: retiring last year's
 * source from the manifest deploys before the ingest that deletes its rows
 * runs, and in between the runtime would no longer know it was annual. Every
 * other source passes untouched, including a doc_key the manifest does not
 * list — a test fixture, or a document ingested by a newer manifest than the
 * one deployed.
 */
export function withinFiscalYear<T extends { docKey: string }>(
  chunks: readonly T[],
  now = new Date(),
  source: VigenciaManifest = MANIFEST,
): T[] {
  const year = crFiscalYear(now);
  const outOfPeriod = new Set([
    ...source.documents
      .filter((entry) => entry.annualChurn && !coversFiscalYear(entry, year))
      .map((entry) => entry.doc_key),
    ...(source.retiredDocKeys ?? []),
  ]);
  return chunks.filter((chunk) => !outOfPeriod.has(chunk.docKey));
}
