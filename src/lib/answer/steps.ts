/**
 * The step catalogue — searching for the step the reader did not ask for
 * (issue #304).
 *
 * #303 read the 19 Tier 1 "answer omission" rows of #267 through the
 * production path and located every missing requirement in the reranked
 * order. Of the 23 that were retrieval, 20 were **pool** depth — the chunk
 * that carries the requirement was deep in the 40 or not among them — and the
 * absent ones share a shape: they carry a *step* the dataset requires of a
 * complete answer and the question never asks for. «¿Dónde me afilio?»
 * requires when to pay; «¿me puedo desinscribir si debo declaraciones?»
 * requires the sanction; «¿qué porcentaje me cobra la Caja?» requires how to
 * adjust the declared income. Neither the question's own legs nor its
 * corpus-register rewrite (#286) look for those, because nothing in the
 * question points at them — and #303 measured that the expansion model cannot
 * be asked to guess them either: a "next step" probe written by Haiku either
 * rewrote the question again or copied the prompt's worked example.
 *
 * The steps are not open-ended, though. The dataset's nine Tier 1 families
 * already name them, and a family's steps are the same whichever of its
 * questions is asked. So they are **written by hand**, two to four sentences
 * per family in the corpus's own register (`eval/step-catalogue.json`,
 * beside the dataset they were written for and verified against the chunks
 * they are meant to reach), and this module does two deterministic things
 * with them:
 *
 * 1. `classifyFamily` names the family a question belongs to — a keyword
 *    table over the normalised question, the `classifyRouting` shape (#264),
 *    no model call, no cost — or `null` when nothing in the question names
 *    one, in which case the search is exactly the one #296 shipped.
 * 2. `stepProbe` returns that family's sentences, which `retrieve` fuses as
 *    one more leg pair, the #286 shape with one difference the measurement
 *    forced: each sentence is its own probe. Concatenated, a three-sentence
 *    text carried «¿Cuándo me corresponde pagar…?» at pool #17 and `cnpt`
 *    art. 79 not at all; each sentence alone carries its chunk at vector
 *    rank 1. So the step vector leg ranks a chunk by its *nearest* sentence
 *    and the lexical leg by its best one (the v6 RPC). At the rerank the
 *    sentences can be scored too (`STEPS_RERANK`, rerank.ts) — off by
 *    default: the catalogue fills the pool, and the question's own readings
 *    decide what reaches the model.
 *
 * Same properties as the expansion, for the same reasons: it can never block
 * an ask (a family that does not classify is a `null`, never a throw), it
 * costs one embed and no model call, and it only ever adds candidates — the
 * question's own legs are computed exactly as before. It shares the RRF sum,
 * so a probe can push a chunk down the fused order; that is the bound the
 * measurement in eval/README.md reads.
 *
 * Since #312 one entry is not a step. A *derived* figure's input is absent
 * from the pool for the same reason a step is — «¿cuánto pago a la CCSS?»
 * never names the wage decree its answer multiplies — and it fails harder,
 * because a figure is arithmetic over every one of its inputs and one missing
 * chunk deletes it. So T1-B and T1-F carry, beside their three steps, the
 * `salarios-minimos` table line the BMC derivation reads. That is the
 * catalogue's shape doing what it is for; nothing here treats it specially.
 *
 * What it deliberately does **not** do is witness corroboration: a chunk
 * found only by the catalogue's legs is not one the reader's words matched
 * (#307), and the probe is the same text for every question in the family,
 * so `isCorroborated` ignores its ranks. The catalogue can fill a pool; it
 * cannot clear the honest decline.
 */
import catalogue from "../../../eval/step-catalogue.json";
import { FAMILIES, type Family } from "../eval/dataset";
import { normaliseQuestion, wordPatterns } from "../routing";

/** One family's entry as committed beside the dataset. */
export interface StepCatalogueEntry {
  /** Two to four corpus-register sentences: the family's steps, and
   * (#312) the input of a figure its answers derive. */
  steps: string[];
  /** The dataset cases the entry was written for. */
  cases: string[];
  /** `docKey · articulo` of the chunks the sentences are meant to reach. */
  reaches: string[];
}

/** The catalogue, typed: every family has an entry (`steps.test.ts` pins it). */
export const STEP_CATALOGUE: Record<Family, StepCatalogueEntry> =
  catalogue.families;

/**
 * Keyword table, matched as whole words on the normalised question (lower
 * case, diacritics stripped) — `classifyRouting`'s rules, so a question that
 * routes and one that classifies are read the same way. Multi-word entries
 * are phrases.
 *
 * Each list names what a reader says when they are asking that family's
 * question, in the vocabulary the demand research recorded (#254): the
 * literal form, the coloquial one, and what a condensed follow-up resolves
 * to. Words shared across families stay out on purpose — bare «factura»
 * would pull every IVA question into T1-C, bare «declaracion» every
 * desinscripción into T1-D — so a family is named by what is *specific* to
 * it, and a question naming nothing specific gets no probe rather than a
 * guessed one.
 */
const KEYWORDS: Record<Family, readonly string[]> = {
  "T1-A": [
    "inscribir",
    "inscribirme",
    "inscribirse",
    "inscribo",
    "inscripcion",
    "meterme en hacienda",
    "registrarme",
    "registro unico tributario",
    "rut",
    "atv",
  ],
  "T1-B": [
    "asegurarme",
    "asegurarse",
    "asegurar",
    "afiliarme",
    "afiliarse",
    "afiliar",
    "afilio",
    "afilia",
    "afiliado",
    "afiliada",
    "afiliacion",
    "obligado a asegurar",
    "obligan a pagar",
    "obligado a cotizar",
    "gano poco",
    "desde cuanta plata",
    "desde cuanto",
  ],
  "T1-C": [
    "factura electronica",
    "comprobante",
    "comprobantes",
    "tiquete",
    "recibo",
    "cabys",
    "codigo cabys",
    "que codigo",
    "cual codigo",
  ],
  "T1-D": ["iva", "valor agregado", "d-104", "en cero"],
  "T1-E": [
    "renta",
    "utilidades",
    "tramos",
    "tramo",
    "d-101",
    "sin facturas",
    "gastos",
    "salario",
    "asalariado",
    "asalariada",
  ],
  "T1-F": [
    "porcentaje",
    "cuanto pago",
    "cuanto se paga",
    "lo minimo",
    "cuota minima",
    "escala",
    "patrono",
    "ingreso de referencia",
    "base minima",
  ],
  "T1-G": [
    "prescripcion",
    "prescriban",
    "prescribir",
    "prescribe",
    "prescritas",
    "cuotas viejas",
    "retroactivo",
    "retroactivos",
    "cobrar desde",
    "cobrarme desde",
    "ventana",
    "24 meses",
  ],
  "T1-H": [
    "desinscribir",
    "desinscribirme",
    "desinscripcion",
    "desinscrito",
    "cese",
    "cesar",
    "deje de trabajar",
    "dejar de trabajar",
    "dejo de trabajar",
    "salirme",
    "me salgo",
    "suspender",
    "suspension",
    "cierre de negocio",
    "ya no trabajo",
  ],
  "T1-I": [
    "multa",
    "multas",
    "sancion",
    "sanciones",
    "tarde",
    "tardia",
    "atrasado",
    "atrasada",
    "no haber declarado",
    "no declare",
    "sin declarar",
    "rebajar la multa",
    "rebaja de la multa",
    "que me pasa",
  ],
};

function byFamily<T>(build: (family: Family) => T): Record<Family, T> {
  const entries = FAMILIES.map((family) => [family, build(family)]);
  return Object.fromEntries(entries) as Record<Family, T>;
}

const PATTERNS = byFamily((family) => wordPatterns(KEYWORDS[family]));

/**
 * The Tier 1 family a question belongs to, or `null` when nothing in it
 * names one.
 *
 * The family with the most keyword hits wins. A tie goes to the **later**
 * family in `FAMILIES`' order, and that is a rule rather than an accident:
 * the later families name a situation — a sanction (T1-I), a cessation
 * (T1-H), a prescription (T1-G) — that presupposes the earlier ones. «Me
 * inscribí un año tarde» names inscription (T1-A) and lateness (T1-I), and
 * the step the reader needs is how to regularise the sanction, not where to
 * inscribe. Zero hits everywhere is `null`: no probe, not a guessed one.
 */
export function classifyFamily(question: string): Family | null {
  const normalised = normaliseQuestion(question);
  let best: { family: Family; hits: number } | null = null;
  for (const family of FAMILIES) {
    const hits = PATTERNS[family].filter((pattern) =>
      pattern.test(normalised),
    ).length;
    if (hits > 0 && hits >= (best?.hits ?? 0)) best = { family, hits };
  }
  return best?.family ?? null;
}

/** What `retrieve` records about the probe it ran, when it ran one. */
export interface StepProbe {
  family: Family;
  /** The family's catalogue sentences, each searched on its own. */
  sentences: string[];
}

/**
 * The step probe for a question: its family's catalogue sentences, or `null`
 * when the question names no family. Deterministic and free — no provider is
 * called here; the embeds happen in `retrieve`, beside the question's.
 */
export function stepProbe(question: string): StepProbe | null {
  const family = classifyFamily(question);
  return family === null
    ? null
    : { family, sentences: [...STEP_CATALOGUE[family].steps] };
}

/**
 * Whether an ask searches the catalogue at all — the one place that decides.
 * `STEPS=off` opts out, read with `||` like `EXPAND` and `RERANK` because CI
 * interpolates an unset variable as "" and that must still mean "default
 * on". No key is involved: the catalogue needs only the embedder the
 * question already uses, so the integration lanes run it too.
 */
export function stepsEnabled(): boolean {
  return (process.env.STEPS || "on") !== "off";
}
