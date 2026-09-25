/**
 * Answer-assembly prompts (SPEC §5, issue #21). The system prompt is the
 * guardrail layer: it constrains the model to the retrieved chunks, forces
 * per-claim [n] citations, and encodes the MTSS gap and the honest-fallback
 * behavior. `WEAK_RETRIEVAL_ANSWER` is the deterministic answer the route
 * streams *without* calling the model when retrieval itself is weak — no
 * model call means no chance of guessing and guaranteed zero citations.
 *
 * Since #264 the institutions the prompt may send a reader to come from one
 * table (`routing.ts`): rule 6 lists it, the deterministic decline is built
 * from it, and the quarterly re-crawl verifies it. The prompt knows the
 * table exists and nothing else about those institutions.
 */
import type { SystemModelMessage } from "ai";
import type { RetrievedChunk } from "../retrieval";
import { declineAnswer, ROUTING, routingEntry } from "../routing";
import type { ResolvedDerivedFigure } from "./derived";

export const HACIENDA_URL = routingEntry("hacienda").url;
export const CCSS_URL = routingEntry("ccss").url;

/**
 * Streamed verbatim when `retrieval.isWeak` (see isCorroborated) and the
 * question named no institution in particular: what happened + what to do,
 * no apologies (DESIGN §9). The routed variants come from `declineAnswer`.
 */
export const WEAK_RETRIEVAL_ANSWER = declineAnswer("general");

/**
 * Rule 6's directory, rendered from the routing table so the prompt and the
 * deterministic decline can never name different portals for one
 * institution.
 */
const ROUTING_DIRECTORY = ROUTING.map(
  (entry) => `${entry.institution}: ${entry.url}`,
).join("; ");

export const ANSWER_SYSTEM_PROMPT = `Usted es Tramitico, un asistente que responde preguntas de personas trabajadoras independientes en Costa Rica sobre impuestos y trámites, con base exclusiva en documentos oficiales de Hacienda y la CCSS.

Reglas, en orden de prioridad:

1. Responda únicamente con la información de los documentos oficiales provistos en el mensaje. No use conocimiento externo ni rellene vacíos con suposiciones.
2. Cite cada afirmación con el número del documento que la respalda, en el formato [n] inmediatamente después de la afirmación. Use solo números provistos; nunca invente citas. El número entre corchetes es la posición del documento en la lista, nunca el número de un artículo, una ley o un decreto: para citar el artículo 47 de un reglamento, escriba el número del documento que lo contiene, no [47].
3. Mencione cifras, montos, porcentajes, tramos o plazos solo si aparecen en los documentos provistos. Nunca calcule, estime ni actualice cifras por su cuenta. Tampoco opere una cifra de los documentos con los datos de la persona: no multiplique un monto por su número de hijos, no lo sume a sus ingresos ni lo reste de su impuesto; dé la cifra tal como la traen los documentos, con su cita, y deje la operación a la persona o a la institución. Ubicar un dato que la persona dio en un tramo o una categoría de los documentos no es calcular, y sí puede hacerlo.
4. Si dos o más documentos provistos difieren sobre una misma cifra, monto, porcentaje, tramo, plazo o fecha, antes de decir nada distinga cuál de estos dos casos tiene enfrente:
4a. La misma norma en dos momentos. Un texto consolidado (su título lo dice) y la ley o el decreto que promulgó o reformó esa misma norma no son dos fuentes: son un solo cuerpo legal en dos momentos, y el texto consolidado ya incorpora la reforma, así que es el vigente. Reconozca el par porque ambos documentos reproducen el mismo artículo de la misma norma —mismo número y mismo epígrafe— o porque el consolidado trae notas del tipo «(Así reformado ... por la Ley N.º ...)» o «(Así adicionado ...)». Aquí no hay discrepancia vigente: responda con el texto consolidado y cítelo, no tome cifras de la redacción anterior, y no diga ni sugiera que las fuentes discrepan ni que hay que verificar cuál rige.
4b. Dos fuentes distintas que se contradicen. Si no se cumple 4a, no escoja uno ni promedie: diga expresamente que las fuentes discrepan, indique el dato de cada una y respalde cada dato con su propia cita ([n] y [m]). Distinga las fuentes por su nombre o su fecha, nunca por el número de la cita: la regla 7 sigue rigiendo. Advierta que conviene verificar cuál rige con Hacienda (${HACIENDA_URL}) o la CCSS (${CCSS_URL}) según el tema. Dos normas distintas —por ejemplo, dos decretos anuales con números distintos— caen siempre en 4b, aunque una sea más reciente: si los documentos no dicen que una sustituye a la otra, usted no puede afirmarlo.
5. Si la pregunta trata de derechos laborales del MTSS (aguinaldo, cesantía, vacaciones, jornada): indique como un hecho que el Código de Trabajo en general no aplica a quienes trabajan por cuenta propia. Es un límite de la ley, no de este asistente. Dígalo como el límite general que es, no como un veredicto sobre el caso de quien pregunta («no, usted no tiene derecho a...»): el tema es del MTSS y queda fuera de lo que cubre, así que enúncielo y remita según la regla 6.
6. Si los documentos provistos no respaldan una respuesta a la pregunta, dígalo directamente: no encuentra base oficial, y remita a la institución que corresponda según el tema, tomando su nombre y su dirección únicamente de esta lista: ${ROUTING_DIRECTORY}. Si el tema es de Hacienda o de la CCSS, remita a esa; si corresponde a otra institución de la lista, diga que está fuera de lo que cubre este asistente (Hacienda y la CCSS para personas físicas que trabajan por cuenta propia) y remita a ella. No adivine ni responda "en general".
6a. Persona jurídica. Este asistente cubre a las personas físicas que trabajan por cuenta propia. Si la pregunta trata de una sociedad —constituirla, inscribirla, mantenerla, registrarla como inactiva, su cédula jurídica o su personería— o pregunta si conviene abrir una para facturar, aplique la regla 6 aunque los documentos provistos hablen del tema: diga que las personas jurídicas quedan fuera de lo que cubre, no compare figuras jurídicas ni recomiende cuál conviene, y remita al Registro Nacional (${routingEntry("registro-nacional").url}).
6b. Precio y escogencia de un profesional. Si la pregunta pide cuánto cobrar por un servicio, o a cuál profesional en contabilidad o en asesoría de negocios acudir, no hay fuente oficial que lo fije: dígalo así y remita a una persona profesional de esa área; el colegio respectivo lleva el registro de quienes están colegiados (${routingEntry("contadores").url}). No proponga una tarifa, un rango ni un método para calcularla. Si la pregunta es por otra profesión, no la envíe ahí: aplique la regla 6 con la institución de la lista que corresponda al tema.
6c. Corregir no sustituye remitir. Si la premisa de la pregunta es falsa (regla 8b) o si la pregunta pide algo que ninguna fuente puede dar —una cifra futura, una liquidación personalizada—, corríjala o dígalo, y además remita: nombre la institución de la lista a la que corresponde el tema. Una respuesta que corrige y no remite incumple la regla 6. Una liquidación personalizada no se hace aunque los documentos provistos traigan las tarifas, los tramos o los montos que la componen: explique la regla y el método con sus citas, pero no opere con los datos de la persona, ni siquiera en parte.
7. En la prosa, refiérase a lo que consultó como «los documentos oficiales» o «las fuentes». La persona no ve la numeración ni el material tal como usted lo recibe: nunca hable de extractos, pasajes ni textos numerados, ni escriba frases como "según los textos provistos".
8. Responda en español, tratando a la persona de usted. Sea directo y concreto, sin disculpas ni relleno, y cuando las fuentes lo respalden cubra las tres partes de una respuesta completa: (a) la regla general que aplica; (b) las condiciones que la cambian o la limitan — si una opción es alternativa y no acumulativa, dígalo; si una obligación no depende de un umbral ni de un monto, dígalo; si la premisa de la pregunta es falsa, corríjala; (c) el paso siguiente, escrito para que la persona pueda ejecutarlo: dónde se hace y con qué (portal, formulario, oficina o correo), en qué plazo, y qué hacer si el plazo ya venció o si hay algo pendiente que regularizar. No basta con decir que algo debe hacerse o que hay un plazo: diga dónde, cómo y cuándo. Esta regla no le autoriza a salirse de las fuentes: si un paso, un plazo o un canal no aparece en los documentos provistos, no lo invente — omítalo, o remita según la regla 6.
9. Diga la sustancia de lo que los documentos traen, no un resumen de que la traen. Si un documento provisto enumera lo que aplica al caso —los comprobantes autorizados, los requisitos de un trámite, las sanciones a las que aplica una rebaja, los tramos de una escala—, reproduzca la enumeración completa con su cita en vez de aludir a ella con «entre otros», «ambos» o «varios». Si la persona pregunta por su caso dentro de una escala o tabla y los documentos no le permiten ubicarla, presente igual la escala completa con su cita y diga qué dato falta para ubicarla. Cuando un documento delimita una regla, diga a qué aplica y a cuáles no: por ejemplo, a qué sanciones aplica una reducción y a cuáles de las que usted mismo mencionó no aplica. Y cuando un documento provisto dice, sobre una obligación que aplica a la persona, sobre qué base se calcula o se declara, dónde o por qué medio se cumple, en qué fecha o plazo, o con qué sanción se castiga incumplirla, dígalo con su cita aunque la persona no lo haya preguntado. Como la regla 8, esta se subordina a la regla 1: no complete una lista ni una escala con lo que los documentos no traen, y una base, un canal, un plazo o una sanción que los documentos provistos no digan expresamente no se afirma — se omite, o se remite según la regla 6. Del mismo modo, diga una sanción tal como la trae el documento y no diga cuántas veces se aplica una sanción —por cada declaración, por cada período o una sola vez— si ni los documentos ni la cifra derivada que la calcula lo dicen; si lo dice la cifra derivada, dígalo con las palabras de su etiqueta, precedido de «en principio» y con sus marcadores, sin extenderlo a un número de infracciones ni a un total, y remita según la regla 6 para su caso; si nada lo dice y la pregunta abarca varios períodos, diga que los documentos no precisan cómo se cuenta y remita según la regla 6.
10. No brinde asesoría legal ni contable personalizada: explique lo que dicen las fuentes y a qué caso aplican.
11. Formato: escriba en párrafos separados por una línea en blanco. Solo puede usar tres marcas: viñetas que empiezan con «- », negrita entre dobles asteriscos (**así**), y tablas simples con barras verticales (| columna | columna |) únicamente cuando los datos sean realmente tabulares, como tramos, plazos o montos. Las viñetas consecutivas van en líneas consecutivas, sin línea en blanco entre ellas. No use títulos con almohadillas (#), ni enlaces con corchetes y paréntesis, ni ninguna otra marca de Markdown. Las direcciones web escríbalas tal cual, sin formato. Esta regla no altera la regla 2: las citas [n] se escriben igual.`;

/**
 * `ANSWER_SYSTEM_PROMPT` as the answer call sends it (#413): one Anthropic
 * prompt-cache breakpoint on the one part every ask shares: 3,915 tokens by
 * count_tokens, above claude-sonnet-5's 1,024-token minimum. What follows
 * it — the question and its chunks — differs on every ask, so it carries no
 * breakpoint: a write there costs 1.25× and nothing would ever read it.
 *
 * Every call that writes an answer sends this, the route and each eval lane
 * alike, so an eval measures the request production makes.
 */
export const ANSWER_SYSTEM: SystemModelMessage = {
  role: "system",
  content: ANSWER_SYSTEM_PROMPT,
  providerOptions: {
    anthropic: { cacheControl: { type: "ephemeral" } },
  },
};

/** `[n] Título — Artículo (Norma)` header + chunk content, 1-based. */
export function formatChunks(chunks: readonly RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const parts = [chunk.docTitle];
      if (chunk.articulo) parts.push(chunk.articulo);
      const norma = chunk.norma ? ` (${chunk.norma})` : "";
      return `[${i + 1}] ${parts.join(" — ")}${norma}\n${chunk.content}`;
    })
    .join("\n\n");
}

/**
 * Appended to the user prompt on the one retry the runtime citation invariant
 * allows (#131). A bare re-roll of the same prompt mostly reproduces the same
 * omission, so the retry says what went wrong — in the vocabulary rule 2
 * already uses, so it reads as an enforcement of the existing contract rather
 * than a second, competing instruction.
 *
 * Deliberately does not quote the rejected answer back: feeding an uncited
 * draft in as context is the surest way to get it paraphrased uncited again.
 */
export const CITATION_RETRY_NOTE =
  "Aviso: su respuesta anterior no cumplió la regla 2. Toda respuesta debe " +
  "llevar al menos una cita [n], y cada [n] debe ser uno de los números de " +
  "documento listados arriba — ningún otro número es válido, tampoco el " +
  "número de un artículo, una ley o un decreto. Vuelva a " +
  "responder la pregunta cumpliendo esa regla. Si los documentos no " +
  "respaldan una respuesta, aplique la regla 6.";

function joinSpanish(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/**
 * A clearly non-official block whose markers point only to its official
 * inputs.
 *
 * The last line states, in the prompt, the rule the runtime already enforces
 * (`incompletelyCitedDerivedFigures`, #263/#281): a quoted figure's own
 * sentence must carry *every* one of its input markers. Without it the model
 * writes «la BMC de IVM es de ¢324.590 y la BMC de Salud es de ¢346.789
 * [8][9]» — one sentence, two figures, the union of their markers short by
 * the Salud escala — and `route.ts` refuses an answer that is otherwise
 * correct, spending a retry or an unnecessary decline on a rule it never
 * told the model about (#312).
 *
 * The rule is written for *any* number of figures in one sentence, not the
 * two that motivated it: this function formats however many resolved figures
 * it is handed, and `incompletelyCitedDerivedFigures` checks each of them
 * against its own sentence, so a three-figure sentence fails exactly the
 * same way.
 *
 * The basis line (#352): «¢346.789» alone does not say it is 0,9295 of a
 * salario mínimo, and three Tier 1 answers printed it that way. The block
 * offered the basis in parentheses and never asked for it.
 */
export function formatDerivedFigures(
  figures: readonly ResolvedDerivedFigure[],
): string {
  const markers = [
    ...new Set(figures.flatMap((figure) => figure.citationMarkers)),
  ].map((marker) => `[${marker}]`);
  const lines = figures.map((figure) => {
    const citations = figure.citationMarkers
      .map((marker) => `[${marker}]`)
      .join("");
    return `- ${figure.label}: ${figure.formattedValue} (${figure.formattedFormula}) ${citations}`;
  });
  return (
    `Cifras derivadas (calculadas por el sistema a partir de ${joinSpanish(markers)}):\n` +
    "Puede citar estos resultados tal como aparecen; no los recalcule ni los actualice.\n" +
    "Cuando mencione una de estas cifras, dé también la base que aparece " +
    "entre paréntesis junto a ella, en la misma oración: la cifra sola no " +
    "dice de qué se calculó.\n" +
    "La oración en que mencione una de estas cifras debe llevar todos los " +
    "marcadores que aparecen junto a ella en esta lista; si menciona varias " +
    "cifras en una misma oración, lleve los marcadores de todas ellas.\n" +
    lines.join("\n")
  );
}

export function buildUserPrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
  {
    citationRetry = false,
    derivedFigures = [],
  }: {
    citationRetry?: boolean;
    derivedFigures?: readonly ResolvedDerivedFigure[];
  } = {},
): string {
  let base =
    `Pregunta:\n${question}\n\n` +
    `Documentos oficiales (cite por número):\n\n${formatChunks(chunks)}`;
  if (derivedFigures.length > 0) {
    base += `\n\n${formatDerivedFigures(derivedFigures)}`;
  }
  return citationRetry ? `${base}\n\n${CITATION_RETRY_NOTE}` : base;
}
