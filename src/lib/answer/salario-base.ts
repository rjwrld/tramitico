/**
 * A multa in salarios base brings the salario base (#579).
 *
 * The CNPT states its sanciones as fractions of a salario base — «una multa
 * equivalente al cincuenta por ciento (50%) del salario base» (art. 79) — and
 * the colones that is are in another instrument altogether, the Corte's
 * yearly circular (`salario-base-2026`). Nothing in the artículo names the
 * circular, so #508's cross-references cannot follow it, and the rerank pool
 * rarely carries it beside a question about something else. Wave E's lane
 * found the gap: `rb-seguimiento-le-cobro-iva` asked whether to charge IVA,
 * a step pin brought `cnpt` 79 along, and the answer said the documents did
 * not carry «el monto vigente del salario base» — true of the set, false of
 * the corpus (#500's zero).
 *
 * So when the set the rerank cut holds a chunk that states a multa or a
 * sanción in salarios base, the salario base in force is appended, unless the
 * set already holds it. Detected by the text, not by a chunk id: `cnpt` 78,
 * 79 and 81 and `ley-iva` 85 bis all say it in those words. A threshold in
 * salarios base that is not a sanción — the IVA's alquiler exemption, the
 * bienes de capital — is out of the owner's decision (option A) and does not
 * trigger.
 *
 * «In force» is #505's reading, not a year written here: the candidates are
 * the manifest entries of the `salario-base` annual series that `retrieve()`
 * would serve today, so on 1 January next year's circular takes over with no
 * code change, and a series with no entry for the year appends nothing. The
 * pool is read first; otherwise one service-role read, fail-open with
 * #508's budget, like the cross-reference lookup.
 *
 * At most one chunk, appended and never replacing, judged on the cut alone.
 * `PIN_SALARIO_BASE=off` is the baseline.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import manifest from "../../../corpus/manifest.json";
import { fold } from "../articulo-key";
import type { Database } from "../database.types";
import { modeKnob } from "../knobs";
import { describeError } from "../log-redaction";
import type { RetrievedChunk } from "../retrieval";
import { tryServiceClient } from "../supabase/service";
import {
  annualSeries,
  isWithheld,
  withheldSources,
  type WithheldSources,
} from "../vigencia";
import {
  LOOKUP_TIMEOUT_MS,
  toChunk,
  type ArticuloRow,
} from "./cross-references";

/** The annual series whose entry for the year states the salario base. */
export const SALARIO_BASE_SERIES = "salario-base";

/**
 * «multa equivalente al cincuenta por ciento (50%) del salario base», «una
 * sanción equivalente a … de un salario base», «la base de la sanción sea
 * igual o inferior al equivalente de quinientos salarios base»: a multa or a
 * sanción, then within the same clause a count of salarios base. Read on
 * folded text; a period inside a number («1.000») does not end the clause.
 */
const SANCTION_IN_SALARIOS_BASE =
  /\b(?:multas?|sancion(?:es)?)\b(?:[^.;:]|\.(?=\d)){0,160}?\bsalarios? base\b/;

/** Whether a chunk states a multa or a sanción in salarios base. */
export function statesSanctionInSalariosBase(
  chunk: Pick<RetrievedChunk, "content">,
): boolean {
  // The ingestion header «[title — artículo]» is a label, not a statement.
  const body = chunk.content.replace(/^\[[^\]]*\]\s*/, "");
  return SANCTION_IN_SALARIOS_BASE.test(fold(body));
}

function inSeries(docKey: string): boolean {
  return annualSeries(docKey) === SALARIO_BASE_SERIES;
}

/**
 * The series' doc_keys `retrieve()` would serve now: last year's circular is
 * withheld from 1 January (#505), so it is never a candidate.
 */
export function salarioBaseDocKeys(
  withheld: WithheldSources,
  docKeys: readonly string[] = manifest.documents.map((d) => d.doc_key),
): string[] {
  return docKeys.filter(
    (docKey) =>
      inSeries(docKey) &&
      !withheld.outOfPeriod.has(docKey) &&
      !withheld.retired.has(docKey),
  );
}

/** Looks the salario base up by doc_key. A seam so tests need no database. */
export type SalarioBaseLookup = (
  docKeys: readonly string[],
  signal?: AbortSignal,
) => Promise<RetrievedChunk[]>;

/** The lookup failing, with the driver's error as `cause` (#136). */
export class SalarioBaseLookupError extends Error {
  constructor(cause: unknown) {
    super("salario base lookup failed", { cause });
    this.name = "SalarioBaseLookupError";
  }
}

/** The stable prefix of the one line a failed lookup logs (docs/runbook.md). */
export const SALARIO_BASE_LOG_PREFIX = "salario-base: lookup failed";

/**
 * The production lookup: the first part of each candidate document, one
 * service-role read of `chunks` joined to `documents`, the read #508's
 * lookup makes. No client fails open, as there.
 */
export function salarioBaseLookup(
  client: Pick<SupabaseClient<Database>, "from"> | null = tryServiceClient(),
): SalarioBaseLookup {
  return async (docKeys, signal) => {
    if (docKeys.length === 0) return [];
    if (client === null) {
      throw new SalarioBaseLookupError(new Error("no service client"));
    }
    let query = client
      .from("chunks")
      .select(
        "id, articulo, path, part, content, documents!inner(doc_key, title, norma, source, effective_date, fetched_at)",
      )
      .in("documents.doc_key", [...docKeys])
      .eq("part", 0);
    if (signal !== undefined) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new SalarioBaseLookupError(error);
    return ((data ?? []) as unknown as ArticuloRow[]).map(toChunk);
  };
}

const salarioBaseKnob = modeKnob("PIN_SALARIO_BASE", ["on", "off"], "on");

/**
 * Whether the pin runs. Unset and empty mean on, like every mode knob
 * (knobs.ts); `off` is the baseline a probe compares against.
 */
export function salarioBaseEnabled(): boolean {
  return salarioBaseKnob() === "on";
}

export interface SalarioBaseOptions {
  /** Omit for the service-role lookup; tests hand in a fake. */
  salarioBaseLookup?: SalarioBaseLookup;
  /** Defaults to what `retrieve()` withholds now (#505). */
  withheld?: WithheldSources;
  /** The ask's own cancellation; the lookup adds `LOOKUP_TIMEOUT_MS`. */
  signal?: AbortSignal;
}

/**
 * The salario base in force, when the cut states a sanción in salarios base
 * and holds no chunk of the series: the pool's if it carries one, otherwise
 * the lookup's. Empty when nothing triggers, when the year has no circular,
 * or when the lookup fails — logged, never thrown.
 */
export async function salarioBaseChunks(
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
  options: SalarioBaseOptions = {},
): Promise<RetrievedChunk[]> {
  if (!salarioBaseEnabled()) return [];
  if (answerSet.some((chunk) => inSeries(chunk.docKey))) return [];
  if (!answerSet.some(statesSanctionInSalariosBase)) return [];

  const withheld = options.withheld ?? withheldSources();
  const docKeys = salarioBaseDocKeys(withheld);
  if (docKeys.length === 0) return [];
  const servable = (chunk: RetrievedChunk) =>
    docKeys.includes(chunk.docKey) && !isWithheld(withheld, chunk);

  const pooled = pool.find(servable);
  if (pooled !== undefined) return [pooled];

  let fetched: RetrievedChunk[];
  try {
    const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    fetched = await (options.salarioBaseLookup ?? salarioBaseLookup())(
      docKeys,
      options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    );
  } catch (error) {
    console.warn(`${SALARIO_BASE_LOG_PREFIX} error=${describeError(error)}`);
    return [];
  }
  // Two entries can both be served only in a manifest that overlaps its own
  // years, which the vigencia test refuses; the newest wins regardless.
  const found = fetched
    .filter(servable)
    .sort((a, b) => (b.effectiveAt ?? "").localeCompare(a.effectiveAt ?? ""));
  return found.slice(0, 1);
}
