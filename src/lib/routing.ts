/**
 * Institution routing for the honest decline (#264, decision record on #254
 * Q1–Q3).
 *
 * The beta covers Hacienda and the CCSS for personas físicas independientes.
 * Everything else — INS, municipalidades, Registro Nacional, colegios
 * profesionales, bancos, MEIC, migración, MTSS — is out of scope *with
 * routing*: when retrieval has nothing to say, the decline names the
 * institution the question belongs to and its official URL, instead of
 * pointing everyone at hacienda.go.cr. No corpus, no encoded facts: the one
 * thing this module knows about another institution is where its front door
 * is.
 *
 * Three parts, all deterministic and dependency-free so both the route and
 * the client can import them:
 *
 * - `ROUTING`, the table — `{ category, institution, url }`. The quarterly
 *   re-crawl verifies every URL answers 200 (`scripts/check-routing-urls.ts`),
 *   so a moved portal is caught by CI, not by a reader.
 * - `classifyRouting`, the classifier — a keyword table over the condensed
 *   question. No model call: it runs only when retrieval is already weak,
 *   and a decline must stay the one path that costs nothing and cannot
 *   guess. The default is what the decline was before #264: Hacienda and
 *   the CCSS, both.
 * - `declineAnswer`, the text the route streams for a category.
 *
 * The category is also the one new field on the per-ask telemetry event
 * (`routedCategory`, telemetry.ts): a content-free count of declines by
 * routing category is half of the evidence the decision record asks for
 * before any of these institutions is promoted to Tier 2. It is an enum
 * from the closed set below, never the question.
 */

/** The institutions the table knows, in routing priority order. */
export const ROUTING_CATEGORIES = [
  "hacienda",
  "ccss",
  "ins",
  "municipal",
  "registro-nacional",
  "colegios",
  "bancos",
  "meic",
  "migracion",
  "mtss",
] as const;

export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];

/**
 * What a decline was routed to. `general` is the default the classifier
 * falls back to — nothing in the question named an institution, so the
 * decline lists Hacienda and the CCSS as it always did.
 */
export type RoutedCategory = RoutingCategory | "general";

export interface RoutingEntry {
  category: RoutingCategory;
  /** The institution's name as the decline prints it, in Spanish. */
  institution: string;
  /** The official front door. Verified HTTP 200 by the quarterly re-crawl. */
  url: string;
}

/**
 * The table. Front doors only — a deep link is a bet on somebody else's
 * site map, and the re-crawl would then be verifying our bet rather than
 * their portal.
 */
export const ROUTING: readonly RoutingEntry[] = [
  {
    category: "hacienda",
    institution: "Ministerio de Hacienda",
    url: "https://www.hacienda.go.cr",
  },
  {
    category: "ccss",
    institution: "CCSS",
    url: "https://www.ccss.sa.cr",
  },
  {
    category: "ins",
    institution: "Instituto Nacional de Seguros (INS)",
    url: "https://www.grupoins.com",
  },
  {
    category: "municipal",
    institution: "la municipalidad de su cantón",
    url: "https://www.ifam.go.cr",
  },
  {
    category: "registro-nacional",
    institution: "Registro Nacional",
    url: "https://www.rnpdigital.com",
  },
  {
    // The first cohort's colegio (developers). A question about another
    // profession's colegio still lands here, and the decline says which
    // institution it names — a colegiado of another profession knows theirs.
    category: "colegios",
    institution: "Colegio de Profesionales en Informática y Computación (CPIC)",
    url: "https://cpic.or.cr",
  },
  {
    category: "bancos",
    institution: "su entidad bancaria",
    url: "https://www.sugef.fi.cr",
  },
  {
    category: "meic",
    institution: "Ministerio de Economía, Industria y Comercio (MEIC)",
    url: "https://www.meic.go.cr",
  },
  {
    category: "migracion",
    institution: "Dirección General de Migración y Extranjería",
    url: "https://www.migracion.go.cr",
  },
  {
    category: "mtss",
    institution: "Ministerio de Trabajo y Seguridad Social (MTSS)",
    url: "https://www.mtss.go.cr",
  },
];

const BY_CATEGORY: Record<RoutingCategory, RoutingEntry> = Object.fromEntries(
  ROUTING.map((entry) => [entry.category, entry]),
) as Record<RoutingCategory, RoutingEntry>;

export function routingEntry(category: RoutingCategory): RoutingEntry {
  return BY_CATEGORY[category];
}

/** The two institutions the default decline lists — the beta's own scope. */
export const GENERAL_ROUTING: readonly RoutingEntry[] = [
  BY_CATEGORY.hacienda,
  BY_CATEGORY.ccss,
];

/** The entries a routed decline links: one for a category, two for `general`. */
export function routingEntriesFor(
  category: RoutedCategory,
): readonly RoutingEntry[] {
  return category === "general" ? GENERAL_ROUTING : [BY_CATEGORY[category]];
}

/**
 * Keyword table, matched as whole words on the normalised question (lower
 * case, diacritics stripped). Multi-word entries are phrases.
 *
 * Two tiers, and the tier is the whole precedence rule: an *out-of-scope*
 * institution wins whenever any of its keywords appears, because the
 * question is on the decline path already — a reader who said «patente»
 * and also «Hacienda» is better sent to the municipalidad than to a portal
 * that will not answer either. Only when none of those match does the
 * choice fall to Hacienda vs CCSS by count, and a tie there (or nothing at
 * all) is `general`.
 *
 * Words that live in Tier 1 vocabulary stay out of the out-of-scope lists
 * on purpose: «extranjero» (clientes en el extranjero, T1-A/D),
 * «residencia» (fiscal), «tarjeta» (retención 2 %), «timbre» (fiscal),
 * «salario mínimo» (the BMC derivation) would each misroute a core
 * question.
 */
const KEYWORDS: Record<RoutingCategory, readonly string[]> = {
  hacienda: [
    "hacienda",
    "tribu",
    "tribu-cr",
    "tributacion",
    "iva",
    "renta",
    "impuesto",
    "impuestos",
    "factura",
    "facturas",
    "facturar",
    "facturo",
    "comprobante",
    "comprobantes",
    "cabys",
    "declaracion",
    "declarar",
    "declaro",
    "d-101",
    "d-104",
    "rut",
    "atv",
    "ovi",
    "regimen simplificado",
    "cnpt",
  ],
  ccss: [
    "ccss",
    "caja",
    "seguro social",
    "sicere",
    "ivm",
    "sem",
    "cuota",
    "cuotas",
    "asegurado",
    "asegurada",
    "asegurarme",
    "aseguramiento",
    "cotizar",
    "cotizo",
    "cotizacion",
    "pension",
    "ebais",
  ],
  ins: [
    "ins",
    "instituto nacional de seguros",
    "riesgos del trabajo",
    "poliza",
    "polizas",
    "marchamo",
  ],
  municipal: [
    "patente",
    "patentes",
    "municipalidad",
    "municipal",
    "municipales",
    "municipio",
    "canton",
    "uso de suelo",
    "bienes inmuebles",
  ],
  "registro-nacional": [
    "registro nacional",
    "sociedad",
    "sociedades",
    "cedula juridica",
    "personeria",
    "sociedad anonima",
    "srl",
    "marca",
    "marcas",
    "escritura publica",
  ],
  colegios: [
    "colegio",
    "colegios",
    "colegiatura",
    "colegiado",
    "colegiada",
    "colegiarme",
    "incorporarme",
    "cpic",
  ],
  bancos: [
    "banco",
    "bancos",
    "bancario",
    "bancaria",
    "prestamo",
    "prestamos",
    "hipoteca",
    "hipotecario",
    "sugef",
  ],
  meic: [
    "meic",
    "pyme",
    "pymes",
    "mipyme",
    "mipymes",
    "registro pyme",
    "consumidor",
  ],
  migracion: [
    "migracion",
    "dimex",
    "permiso de trabajo",
    "nomada digital",
    "nomadas digitales",
    "residencia temporal",
    "residencia permanente",
    "estatus migratorio",
    "categoria migratoria",
    "visa",
    "pasaporte",
  ],
  mtss: [
    "mtss",
    "ministerio de trabajo",
    "codigo de trabajo",
    "aguinaldo",
    "cesantia",
    "vacaciones",
    "jornada",
    "preaviso",
    "liquidacion laboral",
    "despido",
    "horas extra",
  ],
};

const OUT_OF_SCOPE: readonly RoutingCategory[] = ROUTING_CATEGORIES.filter(
  (category) => category !== "hacienda" && category !== "ccss",
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternsFor(category: RoutingCategory): readonly RegExp[] {
  return KEYWORDS[category].map(
    // Word boundaries on ASCII: `normaliseQuestion` has already folded the
    // diacritics away, so `\b` behaves for Spanish here.
    (keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`),
  );
}

const PATTERNS = {
  hacienda: patternsFor("hacienda"),
  ccss: patternsFor("ccss"),
  ins: patternsFor("ins"),
  municipal: patternsFor("municipal"),
  "registro-nacional": patternsFor("registro-nacional"),
  colegios: patternsFor("colegios"),
  bancos: patternsFor("bancos"),
  meic: patternsFor("meic"),
  migracion: patternsFor("migracion"),
  mtss: patternsFor("mtss"),
} satisfies Record<RoutingCategory, readonly RegExp[]>;

/** Lower case, diacritics stripped, whitespace collapsed. */
export function normaliseQuestion(question: string): string {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hits(normalised: string, category: RoutingCategory): number {
  return PATTERNS[category].filter((pattern) => pattern.test(normalised))
    .length;
}

/**
 * Which institution a question that could not be answered belongs to.
 * Deterministic, and closed over the set above — the return value is a
 * telemetry enum as much as a routing decision.
 */
export function classifyRouting(question: string): RoutedCategory {
  const normalised = normaliseQuestion(question);
  let best: { category: RoutingCategory; hits: number } | null = null;
  for (const category of OUT_OF_SCOPE) {
    const count = hits(normalised, category);
    if (count > (best?.hits ?? 0)) best = { category, hits: count };
  }
  if (best) return best.category;

  const hacienda = hits(normalised, "hacienda");
  const ccss = hits(normalised, "ccss");
  if (hacienda === ccss) return "general";
  return hacienda > ccss ? "hacienda" : "ccss";
}

/**
 * The first sentence of every decline, whatever it was routed to. Stable on
 * purpose: e2e/support.ts and the history restore recognise a decline by it.
 */
export const DECLINE_OPENING =
  "No encuentro base oficial en los documentos que manejo para responder " +
  "esta pregunta con confianza, y prefiero no adivinar.";

/** What the beta covers, said once in the decline and once on the empty state. */
export const SCOPE_PHRASE =
  "Hacienda y la CCSS para personas físicas que trabajan por cuenta propia";

/**
 * The deterministic decline for a routing category: what happened, then
 * where to go (DESIGN §9 — no apologies). Streamed verbatim by the route
 * without a model call, so it can carry no citation and cannot guess.
 *
 * Three shapes:
 * - `general` — the pre-#264 text, both institutions listed.
 * - `hacienda` / `ccss` — in scope, no basis found: the one institution.
 * - anything else — out of scope: says so, names the scope, links the
 *   institution.
 */
export function declineAnswer(category: RoutedCategory): string {
  const entries = routingEntriesFor(category);
  const links = entries
    .map((entry) => `- ${entry.institution}: ${entry.url}`)
    .join("\n");
  if (category === "general") {
    return (
      `${DECLINE_OPENING}\n\n` +
      `Puede consultar directamente las fuentes oficiales:\n\n${links}`
    );
  }
  if (category === "hacienda" || category === "ccss") {
    return (
      `${DECLINE_OPENING}\n\n` +
      `Puede consultar directamente la fuente oficial:\n\n${links}`
    );
  }
  const { institution } = entries[0];
  return (
    `${DECLINE_OPENING}\n\n` +
    `Por el tema, la pregunta parece corresponder a ${institution}, ` +
    `que está fuera de lo que cubro: ${SCOPE_PHRASE}.\n\n` +
    `Puede consultar directamente la fuente oficial:\n\n${links}`
  );
}
