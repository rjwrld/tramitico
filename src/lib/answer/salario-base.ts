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
 * So when the set the rerank cut holds a chunk that ties an amount in
 * salarios base to the circular, the salario base in force is appended,
 * unless the set already holds it. Detected by the text, not by a chunk id.
 * #579 read only a multa or a sanción (`cnpt` 78, 79 and 81, `ley-iva` 85
 * bis). #591 read any amount stated as a multiple or a fraction of one, and
 * Wave G's lane found where that overreaches (#599): the circular sets the
 * salario base of Ley 7337 for the Código Penal «y demás normativa … que
 * refieran a la citada norma», so beside «quince salarios base»
 * (`reglamento-iva-bienes-capital` 31) or the simplified regime's limits
 * (`reglamento-rts` 2 and 3), which never name the law, the judges read
 * «¢462.200 applies here» as an inference the set does not support. So the
 * pin fires on #579's sanción, which every lane has grounded, or on an amount
 * in salarios base whose own chunk names Ley 7337 — the IVA's alquiler
 * exemption, «uno coma cinco (1,5) del salario base … la contenida en el
 * artículo 2 de la Ley N.° 7337» (`ley-iva` 8); the student devolución's
 * «medio salario base fijado conforme al artículo 2 de la Ley 7337»
 * (`ley-iva` 11 bis) — since there the set itself carries the tie. The words «salario base»
 * alone, with no count before them («la denominación salario base», «el
 * monto actualizado del salario base»), are not an amount and do not
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
 * What it did is told to `onSalarioBase` (`SalarioBaseOutcome`), the ask
 * event's `salarioBase` field: before #591 a failed lookup was one log line
 * and nothing in the event. `PIN_SALARIO_BASE=off` is the baseline.
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
 * #579's narrower reading, kept for its census (eval/runs/2026-10-09-579/)
 * and #591's comparison: «multa equivalente al cincuenta por ciento (50%)
 * del salario base», «una sanción equivalente a … de un salario base», «la
 * base de la sanción sea igual o inferior al equivalente de quinientos
 * salarios base»: a multa or a sanción, then within the same clause a count
 * of salarios base. Read on folded text; a period inside a number («1.000»)
 * does not end the clause. One of the pin's two triggers since #599.
 */
const SANCTION_IN_SALARIOS_BASE =
  /\b(?:multas?|sancion(?:es)?)\b(?:[^.;:]|\.(?=\d)){0,160}?\bsalarios? base\b/;

/**
 * The count of an amount in salarios base, written out: units, tens and
 * hundreds as the corpus spells them («ciento ochenta y seis», «trescientos
 * treinta y cinco»), «medio», «mil». The last word is the one that touches
 * «salarios base», so it is the only one the pattern needs to know.
 */
const NUMBER_WORD =
  "(?:un|uno|una|medio|media|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci[a-z]+|veinte|veinti[a-z]+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|[a-z]*cientos|quinientos|mil)";

/**
 * A count or a share right before «salario(s) base», in figures or in words,
 * bare or in parentheses, then at most «de», «del» or «de un»: «tres salarios
 * base», «(117) salarios base», «1,000 (mil) salarios base», «medio salario
 * base», «un salario base», «(50%) de un salario base», «(1,5) del salario
 * base», «cincuenta por ciento de un salario base». A figure ends in a
 * digit, so a sentence's closing period is not part of it. Read on folded
 * text.
 */
const AMOUNT_IN_SALARIOS_BASE = new RegExp(
  `(?:\\(?\\d(?:[\\d.,]*\\d)?\\s?%?\\)?|\\(?\\b${NUMBER_WORD}\\)?) (?:del? (?:un )?)?salarios? base\\b`,
);

/**
 * Ley 7337 cited by its number: «Ley 7337», «Ley N.° 7337», «ley No. 7337»,
 * «Ley Nº7337», «Ley 7.337». «Ley» comes first, with no other figure between
 * them, and the number is whole, so another law («Ley 10.620»), a longer
 * number («17337», «7337,5») or an amount that happens to be 7337 is not it.
 * Read on folded text.
 */
const LEY_7337 = /\bley\b[^\d]{0,12}7\.?337(?!\d|[.,]\d)/;

/** The text a detector reads: folded, without the ingestion header. */
function body(chunk: Pick<RetrievedChunk, "content">): string {
  // The ingestion header «[title — artículo]» is a label, not a statement.
  return fold(chunk.content.replace(/^\[[^\]]*\]\s*/, ""));
}

/** Whether a chunk states a multa or a sanción in salarios base (#579). */
export function statesSanctionInSalariosBase(
  chunk: Pick<RetrievedChunk, "content">,
): boolean {
  return SANCTION_IN_SALARIOS_BASE.test(body(chunk));
}

/**
 * Whether a chunk states an amount in salarios base (#591). Every sanción
 * #579 read is one. Since #599 an amount alone does not fire the pin; see
 * `triggersSalarioBase`.
 */
export function statesAmountInSalariosBase(
  chunk: Pick<RetrievedChunk, "content">,
): boolean {
  return AMOUNT_IN_SALARIOS_BASE.test(body(chunk));
}

/** Whether a chunk names Ley 7337, the salario base's law, in its own text. */
export function namesLey7337(chunk: Pick<RetrievedChunk, "content">): boolean {
  return LEY_7337.test(body(chunk));
}

/**
 * The pin's trigger (#599): a multa or a sanción in salarios base (#579), or
 * an amount in salarios base in a chunk that names Ley 7337 itself — the
 * circular's own scope, so the set ties the figure to the law it is for.
 */
export function triggersSalarioBase(
  chunk: Pick<RetrievedChunk, "content">,
): boolean {
  return (
    statesSanctionInSalariosBase(chunk) ||
    (statesAmountInSalariosBase(chunk) && namesLey7337(chunk))
  );
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

/**
 * What the pin did on one ask (#591), for the ask event's `salarioBase`
 * field — a closed set, never which chunk:
 *
 * - `not_triggered` — no chunk of the cut triggers it (`triggersSalarioBase`).
 * - `already_in_set` — one does, and the cut holds the series already.
 * - `appended` — the salario base in force went in, from the pool or the
 *   lookup.
 * - `missing` — one does, the lookup answered, and there was nothing to
 *   append: the year serves no circular (#505's January before the
 *   December pass, runbook §2.2), or the database holds none of it.
 * - `failed` — the lookup threw: an error, no service client, its budget.
 */
export type SalarioBaseOutcome =
  "not_triggered" | "already_in_set" | "appended" | "missing" | "failed";

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
  /** Told what the pin did, once per call; never called when it is off. */
  onSalarioBase?: (outcome: SalarioBaseOutcome) => void;
}

/**
 * The salario base in force, when a chunk of the cut triggers it
 * (`triggersSalarioBase`) and the cut holds no chunk of the series: the
 * pool's if it carries one, otherwise the lookup's. Empty when nothing triggers, when the year has no circular,
 * or when the lookup fails — logged, never thrown.
 */
export async function salarioBaseChunks(
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
  options: SalarioBaseOptions = {},
): Promise<RetrievedChunk[]> {
  if (!salarioBaseEnabled()) return [];
  const settle = (
    outcome: SalarioBaseOutcome,
    chunks: RetrievedChunk[] = [],
  ): RetrievedChunk[] => {
    options.onSalarioBase?.(outcome);
    return chunks;
  };
  if (!answerSet.some(triggersSalarioBase)) {
    return settle("not_triggered");
  }
  if (answerSet.some((chunk) => inSeries(chunk.docKey))) {
    return settle("already_in_set");
  }

  const withheld = options.withheld ?? withheldSources();
  const docKeys = salarioBaseDocKeys(withheld);
  if (docKeys.length === 0) return settle("missing");
  const servable = (chunk: RetrievedChunk) =>
    docKeys.includes(chunk.docKey) && !isWithheld(withheld, chunk);

  const pooled = pool.find(servable);
  if (pooled !== undefined) return settle("appended", [pooled]);

  let fetched: RetrievedChunk[];
  try {
    const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    fetched = await (options.salarioBaseLookup ?? salarioBaseLookup())(
      docKeys,
      options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    );
  } catch (error) {
    console.warn(`${SALARIO_BASE_LOG_PREFIX} error=${describeError(error)}`);
    return settle("failed");
  }
  // Two entries can both be served only in a manifest that overlaps its own
  // years, which the vigencia test refuses; the newest wins regardless.
  const found = fetched
    .filter(servable)
    .sort((a, b) => (b.effectiveAt ?? "").localeCompare(a.effectiveAt ?? ""))
    .slice(0, 1);
  return settle(found.length > 0 ? "appended" : "missing", found);
}
