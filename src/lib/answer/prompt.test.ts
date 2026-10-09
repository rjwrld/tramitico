import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { declineAnswer, ROUTING, routingEntry } from "../routing";
import {
  incompletelyCitedDerivedFigures,
  type ResolvedDerivedFigure,
} from "./derived";
import {
  ANSWER_SYSTEM,
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  CCSS_URL,
  CITATION_RETRY_NOTE,
  formatDerivedFigures,
  formatChunks,
  formatToday,
  HACIENDA_URL,
  WEAK_RETRIEVAL_ANSWER,
} from "./prompt";

const TODAY = "2026-09-29";

const DERIVED_FIGURE: ResolvedDerivedFigure = {
  id: "bmc-ivm-2026",
  label: "Base mínima contributiva de IVM 2026",
  formula: "factor * sm.tonc",
  decimals: 0,
  inputs: [],
  value: 324_590.301,
  formattedValue: "¢324.590",
  formattedFormula: "0,87 × ¢373.092,30",
  citationMarkers: [1, 2],
};

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    docKey: "ley-9635",
    docTitle: "Ley de Fortalecimiento de las Finanzas Públicas",
    norma: "Ley 9635",
    articulo: "Artículo 4",
    path: [],
    part: 0,
    content: "La tarifa general del impuesto es del trece por ciento (13%).",
    source: {},
    fetchedAt: "2026-08-06T15:04:05Z",
    score: 0.03,
    vectorRank: 1,
    lexicalRank: 1,
    ...overrides,
  };
}

describe("formatChunks", () => {
  it("numbers chunks from 1 and includes title, articulo and content", () => {
    const text = formatChunks([
      chunk(),
      chunk({ chunkId: "c2", articulo: "Artículo 5", content: "Otra cosa." }),
    ]);
    expect(text).toContain(
      "[1] Ley de Fortalecimiento de las Finanzas Públicas",
    );
    expect(text).toContain("Artículo 4");
    expect(text).toContain("La tarifa general del impuesto");
    expect(text).toContain("[2]");
    expect(text).toContain("Artículo 5");
  });

  it("includes the norma when present and omits missing articulo", () => {
    const text = formatChunks([chunk({ norma: null, articulo: null })]);
    expect(text).toContain(
      "[1] Ley de Fortalecimiento de las Finanzas Públicas",
    );
    expect(text).not.toContain("null");
  });
});

describe("buildUserPrompt", () => {
  it("contains the question and the formatted chunks", () => {
    const prompt = buildUserPrompt("¿Cuánto es el IVA?", [chunk()], {
      today: TODAY,
    });
    expect(prompt).toContain("¿Cuánto es el IVA?");
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("13%");
  });

  it("labels the provided material as documentos oficiales (#75)", () => {
    const prompt = buildUserPrompt("¿Cuánto es el IVA?", [chunk()], {
      today: TODAY,
    });
    expect(prompt).toContain("Documentos oficiales");
    expect(prompt).not.toMatch(/fragmento|chunk/i);
  });

  it("appends system-calculated figures with their input markers", () => {
    const prompt = buildUserPrompt("¿Cuánto pago?", [chunk(), chunk()], {
      today: TODAY,
      derivedFigures: [DERIVED_FIGURE],
    });

    expect(prompt).toContain(
      "Cifras derivadas (calculadas por el sistema a partir de [1] y [2])",
    );
    expect(prompt).toContain(
      "Base mínima contributiva de IVM 2026: ¢324.590 (0,87 × ¢373.092,30) [1][2]",
    );
  });

  it("omits the derived-figure block when there are no resolved figures", () => {
    expect(
      buildUserPrompt("¿Cuánto pago?", [chunk()], {
        today: TODAY,
        derivedFigures: [],
      }),
    ).not.toContain("Cifras derivadas");
  });

  // #451: Anthropic's long-context guidance puts the documents first and the
  // query last. The prompt had it the other way round since #21: the question,
  // then ~12k tokens of documents between it and the answer.
  it("puts the question after the documents and the derived figures (#451)", () => {
    const prompt = buildUserPrompt("¿Cuánto pago?", [chunk(), chunk()], {
      today: TODAY,
      derivedFigures: [DERIVED_FIGURE],
    });
    const question = prompt.indexOf("Pregunta:\n¿Cuánto pago?");
    expect(question).toBeGreaterThan(prompt.indexOf("[2]"));
    expect(question).toBeGreaterThan(prompt.indexOf("Cifras derivadas"));
    // Nothing after it (#451): a closing completeness note replayed well
    // (Tier 1 77 → 81 of 116 on fixed chunks) and then, on the full lane,
    // pulled inferred facts into a blocking answer and uncited figures into
    // two declines. The question is the last thing the model reads.
    expect(prompt.endsWith("Pregunta:\n¿Cuánto pago?")).toBe(true);
  });

  // #455: «¿hasta qué día tengo?» can only hedge without it.
  it("states today's Costa Rica date right before the question (#455)", () => {
    const prompt = buildUserPrompt("¿Hasta qué día tengo?", [chunk()], {
      today: TODAY,
    });
    expect(prompt).toContain(
      "Fecha de hoy en Costa Rica: 29 de septiembre de 2026.\n\nPregunta:\n¿Hasta qué día tengo?",
    );
    expect(prompt.indexOf("Fecha de hoy")).toBeGreaterThan(
      prompt.indexOf("[1]"),
    );
  });
});

describe("formatToday (#455)", () => {
  it("writes the date the way the documents write theirs", () => {
    expect(formatToday("2026-09-29")).toBe(
      "Fecha de hoy en Costa Rica: 29 de septiembre de 2026.",
    );
    expect(formatToday("2027-01-01")).toBe(
      "Fecha de hoy en Costa Rica: 1 de enero de 2027.",
    );
    expect(formatToday("2026-12-31")).toBe(
      "Fecha de hoy en Costa Rica: 31 de diciembre de 2026.",
    );
  });
});

describe("formatDerivedFigures", () => {
  it("deduplicates source markers in the heading", () => {
    expect(
      formatDerivedFigures([
        DERIVED_FIGURE,
        { ...DERIVED_FIGURE, id: "second", citationMarkers: [2, 3] },
      ]),
    ).toContain("a partir de [1], [2] y [3]");
  });

  it("states the rule the runtime enforces on a quoted figure (#312)", () => {
    // `incompletelyCitedDerivedFigures` refuses a figure whose own sentence
    // is short one input marker, and F1's answer lost the SEM figure to
    // exactly that — two figures in one sentence, the union short by the
    // Salud escala. A validator the prompt never states is a retry waiting
    // to happen.
    const block = formatDerivedFigures([
      DERIVED_FIGURE,
      { ...DERIVED_FIGURE, id: "second", citationMarkers: [2, 3] },
    ]);
    expect(block).toContain("todos los marcadores");
    // The operative half: without it the rule reads as "cite the figure" and
    // the model can still write two figures under one marker set.
    expect(block).toContain("los marcadores de todas ellas");
  });

  /**
   * #458 (#403's shape on 5.5): `ho-desde-cuanta-plata-caja` cited
   * «¢324.590 (0,87 SM; …) [8][10]», then repeated it as «Como la
   * obligatoriedad rige desde la BMC de menor cuantía [2][5], la referencia
   * es la de IVM (¢324.590).» The runtime reads every quote and the markers
   * after it, so the repeat failed the gate; 5.5 did not read a
   * parenthetical repeat as a mention. The block names the two ways out, and
   * they are the two the runtime accepts.
   */
  it("counts every mention, a repeat included, or names the figure instead (#458)", () => {
    const block = formatDerivedFigures([DERIVED_FIGURE]);
    expect(block).toContain("después de la cifra, todos los marcadores");
    expect(block).toContain(
      "también la que repite una cifra ya dada, la que va entre paréntesis, la que la compara con otra",
    );
    expect(block).toContain(
      "nómbrela por su etiqueta («Base mínima contributiva de IVM 2026») sin repetir el monto",
    );

    const cited = "La BMC de IVM es de ¢324.590 (0,87 × ¢373.092,30) [1][2].";
    expect(
      incompletelyCitedDerivedFigures(
        `${cited} Como rige desde la BMC [1], la referencia es la de IVM (¢324.590).`,
        [DERIVED_FIGURE],
      ),
    ).toEqual(["bmc-ivm-2026"]);
    expect(
      incompletelyCitedDerivedFigures(
        `${cited} Como rige desde la BMC [1], la referencia es la de IVM (¢324.590) [1][2].`,
        [DERIVED_FIGURE],
      ),
    ).toEqual([]);
    expect(
      incompletelyCitedDerivedFigures(
        `${cited} Como rige desde la BMC [1], la referencia es la Base mínima contributiva de IVM 2026.`,
        [DERIVED_FIGURE],
      ),
    ).toEqual([]);
  });

  /**
   * #458 after #463: with the label offered only as an alternative,
   * `multa-iva-no-declarado` cited «¢231.100» and then wrote it bare in the
   * sentence that says what to confirm with Hacienda — the one rule 9 puts
   * at the end, beside the referral, where nothing else is a claim to cite.
   * The block names that sentence as a mention, and makes the label the
   * default for every mention after the first.
   */
  it("counts the sentence of what to confirm, and makes the label the default after the first mention (#458)", () => {
    const block = formatDerivedFigures([DERIVED_FIGURE]);
    expect(block).toContain(
      "la que dice lo que debe confirmar con la institución sobre ella",
    );
    expect(block).toContain(
      "Dé el monto una vez, con sus marcadores; para volver a referirse a la cifra, nómbrela por su etiqueta",
    );
    expect(block).toContain(
      "Si repite el monto, esa oración lleva otra vez todos sus marcadores.",
    );

    const cited = "La BMC de IVM es de ¢324.590 (0,87 × ¢373.092,30) [1][2].";
    expect(
      incompletelyCitedDerivedFigures(
        `${cited} La cifra de ¢324.590 es la de 2026, y lo demás lo debe confirmar con la CCSS.`,
        [DERIVED_FIGURE],
      ),
    ).toEqual(["bmc-ivm-2026"]);
    expect(
      incompletelyCitedDerivedFigures(
        `${cited} La Base mínima contributiva de IVM 2026 es la de este año, y lo demás lo debe confirmar con la CCSS.`,
        [DERIVED_FIGURE],
      ),
    ).toEqual([]);
  });

  it("asks for the figure's basis beside it, not the figure alone (#352)", () => {
    // Three Tier 1 answers printed «¢346.789» and dropped the «0,9295 SM» it
    // is a multiple of: the block offered the basis and never asked for it.
    const block = formatDerivedFigures([
      { ...DERIVED_FIGURE, formattedFormula: "0,87 SM; SM = ¢373.092,30" },
    ]);
    expect(block).toContain("¢324.590 (0,87 SM; SM = ¢373.092,30) [1][2]");
    expect(block).toContain(
      "dé también la base que aparece entre paréntesis junto a ella",
    );
  });

  it("states it for any number of figures in one sentence, not two", () => {
    // `formatDerivedFigures` formats however many figures it is handed and
    // `incompletelyCitedDerivedFigures` checks each against the same
    // paragraph, so a rule worded for exactly two would leave a
    // three-figure sentence failing validation with the prompt silent
    // about it.
    const block = formatDerivedFigures([
      DERIVED_FIGURE,
      { ...DERIVED_FIGURE, id: "second", citationMarkers: [2, 3] },
      { ...DERIVED_FIGURE, id: "third", citationMarkers: [4, 5] },
    ]);
    expect(block).toContain("varias");
    expect(block).not.toContain("dos cifras");
    expect(block).toContain("a partir de [1], [2], [3], [4] y [5]");
  });

  it("keeps its own words out of the answer (#557)", () => {
    // «La cifra derivada es ¢231.100», «la etiqueta de la cifra dice…»: the
    // block's names for what it hands over, written back to the reader.
    expect(formatDerivedFigures([DERIVED_FIGURE])).toContain(
      "Las palabras de esta lista («cifra derivada», «etiqueta», «marcador») son para usted, no para la persona: no las escriba en la respuesta.",
    );
  });
});

describe("ANSWER_SYSTEM_PROMPT", () => {
  it("is Spanish usted voice with the core guardrails", () => {
    expect(ANSWER_SYSTEM_PROMPT).toContain("usted");
    // Answer only from provided chunks.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/únicamente/i);
    // Cite per claim with [n].
    expect(ANSWER_SYSTEM_PROMPT).toContain("[n]");
    // Numeric figures only if present in chunks.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/cifras|montos/i);
    // MTSS gap stated as fact.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/Código de Trabajo/);
    // Honest fallback instruction with agency links.
    expect(ANSWER_SYSTEM_PROMPT).toContain("hacienda.go.cr");
    expect(ANSWER_SYSTEM_PROMPT).toContain("ccss.sa.cr");
  });

  /**
   * #289: the 2026 baseline scored Tier 1 adequacy 2/27 while groundedness
   * passed 70/73 on the same answers — supported and incomplete. Most of what
   * was missing was `requiredSteps` (where to file, what to do once the
   * deadline has passed) and scope claims («es una alternativa, no un
   * añadido»), and the prompt asked for neither: rule 8 said «qué aplica y
   * qué hacer» and stopped there. PRODUCT.md's purpose names three parts —
   * the rule, the conditions that change it, and supported next steps — so
   * rule 8 now names all three.
   */
  it("asks for the rule, its conditions and the next step (#289)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/condiciones/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/paso siguiente|pasos siguientes/i);
    // A step is a place and a plazo, not "hay que hacer un trámite".
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/dónde/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/plazo/i);
  });

  /**
   * #451: Sonnet 5.5 wrote rule 8's three parts as bold section titles
   * («**Regla general**», «**Paso siguiente**») in 15–19 of 27 Tier 1 answers
   * of the 2026-09-28 run, against 1 on Sonnet 5.
   */
  it("says the three parts are coverage, not headings (#451)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /8\. [^\n]*no las use como títulos ni como rótulos en negrita/,
    );
  });

  /**
   * #451: the prompt listed rules and never said what they were for. Anthropic's
   * guidance is to give the reason behind an instruction and to ask outright
   * for more than the minimum; the reason here is that the reader acts on the
   * answer, and «consulte» sends them back to where they started.
   */
  it("says why completeness matters: the person acts on the answer (#451)", () => {
    const intro = ANSWER_SYSTEM_PROMPT.split(
      "Reglas, en orden de prioridad:",
    )[0];
    expect(intro).toMatch(/va a actuar con su respuesta/);
    expect(intro).toMatch(/la deja donde empezó/);
  });

  it("keeps the new actionability rule inside the sources (#289 vs rule 1)", () => {
    // Asking for steps the documents do not carry would buy adequacy with
    // invention — the one trade this prompt may never make.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no lo invente/i);
  });

  /**
   * #289, the read after #303/#304: with the step's fragment in front of the
   * model, the answer still summarised it — «ambos son comprobantes
   * autorizados» for art. 9's seven-item list, «la sanción del artículo 79»
   * for art. 88's «78, 79, 81 y 83» (and so never said the 1 % morosidad it
   * had just cited is *not* reduced), «categorías desde 0.9295 SM hasta 6 SM
   * y más» for an escala it was handed in full. Rule 9 asks for the substance:
   * enumerate, delimit, and state base, place, plazo and sanción when the
   * documents carry them — and it stays inside rule 1.
   */
  it("asks for the enumeration, not a summary of it (#289)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/enumera/i);
    // The failure mode by name: a gesture at the list instead of the list.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/«entre otros»|«ambos»/);
    // An escala the reader cannot be placed in is still given whole.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/escala completa/i);
  });

  it("asks for the limits of a rule and the four facts of an obligation (#289)", () => {
    // Scope: what a rule covers and what it leaves out.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/a cuáles no/i);
    // Base, place, plazo, sanción — each named, none inferred.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/sobre qué base/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/dónde o por qué medio/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/en qué fecha o plazo/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/con qué sanción/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /aunque la persona no lo haya preguntado/i,
    );
  });

  it("keeps the enumeration rule inside the sources (#289 vs rule 1)", () => {
    // The rule must say, in its own text, that it adds nothing the documents
    // do not carry — otherwise it reads as licence to complete a list.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/9\. [^\n]*no complete/i);
    // …and the clause that volunteers unasked facts is guarded by name: a
    // base, canal, plazo or sanción the documents do not state is never
    // inferred.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*no invente una base, un paso, un canal, un plazo ni una sanción/,
    );
  });

  /**
   * #451: rules 8 and 9 each ended in «omítalo» / «se omite», under «se
   * subordina a la regla 1». Sonnet 5.5 settled that framing by leaving out
   * what the documents did carry and writing «los documentos no detallan el
   * portal… consulte» where Sonnet 5 gave the step: 3–4 of its Tier 1 misses
   * per arm. The rules do not compete — rule 1 says where a fact comes from,
   * 8 and 9 which facts must not be left out — so the boundary says that, and
   * says what to do with a real gap: give what the documents carry, and name
   * the gap once, at the end, with the referral.
   */
  it("frames grounding and completeness as not competing (#451)", () => {
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(/se subordina a la regla 1/);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*no compiten con la regla 1/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*en una sola oración, al final y junto con la remisión de la regla 6/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*no la anuncie al principio ni la repita/,
    );
  });

  /**
   * #451: Sonnet 5.5 applied the unasked-obligation clause only to the
   * obligation the question named, and left out ones the documents tied to it
   * in the reader's case.
   */
  it("extends the unasked facts to obligations tied to the one asked about (#451)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*también a las que los documentos provistos le ligan en su caso/,
    );
  });

  /**
   * #352 req. 3: `ho-abs-calculo-personalizado` (an exact renta for the
   * asker's own income and two hijos) declined the liquidación, gave the escala
   * with its citation — rule 9 working — and then wrote «con dos hijos … es
   * decir, ¢41.040,00 en total»: the cited ¢20.520,00 per hijo, multiplied by
   * the asker's own count. No document carries that figure, so the abstention
   * lane's figure gate counts it invented. Rule 3's «nunca calcule» did not
   * read as covering arithmetic on the person's own data.
   */
  it("forbids arithmetic on the person's own data (#352)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*Tampoco opere una cifra de los documentos con los datos de la persona/,
    );
    // The shape that failed, by name: a per-unit amount times the asker's count.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/3\. [^\n]*por su número de hijos/);
    // What to do instead: the figure as the documents give it, cited.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*tal como la traen los documentos/,
    );
  });

  it("keeps placing the person in a tramo allowed (#352 vs #289)", () => {
    // The clause is about arithmetic, not comparison: `ho-800-mil-que-
    // porcentaje-caja` requires «¢800.000 … cae en la categoría 3», and rule
    // 9 asks for the escala precisely so the reader can be placed in it. A
    // rule 3 that read «apply» broadly would forbid what rule 9 asks for.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*Ubicar un dato que la persona dio en un tramo o una categoría de los documentos no es calcular/,
    );
  });

  it("lets a documented date be compared with today, and no more (#455)", () => {
    // Saying a plazo has passed is a comparison, like placing a figure in a
    // tramo; counting days from today is arithmetic rule 3 still forbids.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*Tampoco es calcular comparar una fecha que traen los documentos con la fecha de hoy/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*«el plazo del 15 de octubre ya pasó»/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*no sume ni reste días ni proyecte fechas/,
    );
    // 455 r1/r2: with no vigencia date in the chunks, ccss-ventana reasoned
    // «más de tres años después de la firma … ya venció» — elapsed time from
    // an assumed date. Only a date the documents write is compared.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*Compare solo fechas que los documentos escriben: no suponga una fecha que no traen ni razone sobre el tiempo transcurrido/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*si la fecha que haría falta no está entre lo que recibió, no la suponga: diga que esa fecha debe confirmarla con la institución/,
    );
    // The date itself is the user prompt's: the system prompt is cached.
    expect(ANSWER_SYSTEM_PROMPT).not.toContain("Fecha de hoy en Costa Rica:");
  });

  /**
   * #572: `renta-plazo-followup` asks when to file the annual declaración,
   * whose plazo runs after 31 December, and 5.5 wrote «La fecha de setiembre
   * de 2026 ya pasó» about the pagos parciales the documents date «setiembre
   * de cada año» (#557's control d2, round 1 d2; the judges failed both 3/3).
   * The year is one the documents never write, which the clause above already
   * forbids, and the date belongs to another obligation than the one asked.
   */
  it("compares only the plazo asked about, with no year the documents lack (#572)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*Esa comparación es solo para el plazo por el que la persona pregunta: no diga si ya pasó la fecha de otra obligación que la respuesta menciona de paso/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /3\. [^\n]*ni le ponga el año en curso a una fecha que los documentos dan para cada año \(«la cuota de setiembre de 2026 ya pasó»\)/,
    );
  });

  it("declines a personalised calculation even when the documents carry its inputs (#352)", () => {
    // 6c already named «una liquidación personalizada»; what it did not say is
    // that having every input in hand does not make it the answer's to do.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6c\. [^\n]*aunque los documentos provistos traigan las tarifas, los tramos o los montos/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6c\. [^\n]*no opere con los datos de la persona, ni siquiera en parte/,
    );
  });

  /**
   * #352 req. 4: `ho-cliente-espana-lleva-iva` cited «[6][47]» on an 8-chunk
   * answer — reglamento-iva art. 47 was in the set at [5], and the model wrote
   * the artículo's number where the document's belonged. The invariant
   * catches it and the route retries; rule 2 should keep it from being
   * written in the first place.
   */
  it("says a marker is the document's number, never an artículo's (#352)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*nunca el número de un artículo, una ley o un decreto/,
    );
    // The worked form of the rule: which [n] to use for «artículo 47».
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*el número del documento que lo contiene/,
    );
  });

  /**
   * #454: Sonnet 5.5 writes lists — 107–157 bullet lines across the 27 Tier 1
   * answers, against Sonnet 5's 34 — and cites the line that introduces one,
   * «Sobre el pago, los documentos dicen lo siguiente [6]:», then none of the
   * bullets under it. The checks read a citation per sentence, so each such
   * bullet is an uncited figure: «75%» tripped the abstention figure gate on
   * `ho-abs-calculo-personalizado`. On `ho-rebajar-multa-si-pago-ya` the
   * bullet did carry [1], on its second sentence, and «75%» sat in its first.
   * Told only that each sentence of a bullet «lleva la suya», 5.5 still
   * wrote that bullet again on the second replay; the clause now says why a
   * marker does not reach back — it backs its own sentence, even when the one
   * before comes from the same document.
   */
  it("gives each bullet and table row its own marker, not its lead-in's (#454)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*Una cita respalda solo la oración en que está: no cubre la oración anterior, aunque las dos vengan del mismo documento, ni los elementos de la lista o la tabla que introduce\./,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*cada viñeta y cada fila de una tabla que dé una cifra o una afirmación lleva su propia cita \[n\], y si una viñeta tiene dos oraciones, las dos la llevan/,
    );
  });

  /**
   * #572: Wave D's one red. `ho-abs-devs-exentos-renta` wrote «los servicios
   * de desarrollo de software tienen código CABYS con IVA de 13%.» with no
   * marker, and cited `cabys-dev` [1] in the example after it; the abstention
   * gate (`figureMentions`) reads a figure never cited in its own sentence as
   * invented. The same lane wrote «la sanción se rebaja en un 75%.» before
   * its [8], and «todos con IVA de 13%:» over the list that cites. The clause
   * names the three things the next sentence carried: an example, the rule's
   * other half, a list.
   */
  it("gives a figure's sentence its own marker, whatever follows it (#572)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*la oración que da una cifra, un porcentaje o un monto lleva su propia cita aunque la siguiente cite el mismo documento con un ejemplo, la otra mitad de la regla o la lista que ella introduce/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*«la tarifa es de …% \[n\]\. Por ejemplo, … \[n\]\.», no «la tarifa es de …%\. Por ejemplo, … \[n\]\.»/,
    );
  });

  /**
   * #454's first replay: told that each bullet cites itself, 5.5 wrote
   * «- Las rentas de hasta ¢6.244.000,00 anuales no están sujetas al
   * impuesto. [1][2]» on 28 lines of 3 answers, and on none before. A
   * sentence ends at its period for the literal check, the abstention figure
   * gate and the runtime's derived-figure check alike, so a marker after it
   * cites nothing: `ho-minimo-renta-2026` lost «¢6.244.000» that way.
   */
  it("puts the marker before the period that closes the sentence (#454)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /2\. [^\n]*inmediatamente después de la afirmación y antes del punto que la cierra \(«no están sujetas al impuesto \[2\]\.»\)/,
    );
  });

  /**
   * #427: about 1 Sonnet 5 answer in 70 corrected a doubted marker inside the
   * brackets — «[4][6][10 no existe, cito 6]», «[7][10 nota: cita 7]» — and
   * rule 2 said a marker holds a number and nothing else. #451: Sonnet 5.5
   * wrote none in 146 answers (the two 2026-09-28 arms), so the clause leaves
   * the system prompt. The invariant still refuses one, and the retry note —
   * sent only then — still names it (below).
   */
  it("leaves the bracket-annotation clause to the retry note (#427, #451)", () => {
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(
      /ninguna palabra, nota ni corrección entre los corchetes/,
    );
    expect(CITATION_RETRY_NOTE).toMatch(
      /ninguna palabra, nota ni corrección entre los corchetes/,
    );
  });

  /**
   * #352, `multa-iva-no-declarado` (blocking): cnpt art. 79 gives «una multa
   * equivalente al cincuenta por ciento (50%) del salario base» to whoever
   * omits «las declaraciones», and never says how it is counted. The judge
   * failed «se aplica por cada declaración omitida» 3/3 on one reading and
   * «multa fija … no se calcula por cada mes» 3/3 on the next: it rejects a
   * count in either direction, because the article states none. Rule 9's
   * subordination clause already names base, canal, plazo and sanción; the
   * count of a sanction is the one it did not name.
   */
  it("keeps out a count of a sanction the documents do not state (#352)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*no diga cuántas veces se aplica una sanción/,
    );
    // Both directions the judge failed, by name.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*por cada declaración, por cada período o una sola vez/,
    );
    // What to do instead, for a question about several periods.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*diga que cómo se cuenta debe confirmarlo con la institución/,
    );
  });

  // #352, 2026-09-25: the owner ruled art. 79 applies per omitted declaration,
  // and the derived figure's label says so. No official document states that
  // count (searched 2026-09-25), so the answer says it in the label's words
  // with «en principio» — the one wording the judges have passed 3/3 — and
  // never extends it: «tres infracciones separadas» failed 3/3 on the lane.
  it("says a sanction's count only in its derived figure's words (#352)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*si ni los documentos ni la cifra derivada que la calcula lo dicen; si lo dice la cifra derivada, dígalo con las palabras de su etiqueta, precedido de «en principio» y con sus marcadores, sin extenderlo a un número de infracciones ni a un total/,
    );
  });

  /**
   * #557: «la cifra derivada es ¢231.100» to the reader, and a refusal in
   * the first person — «no calculo su caso», «no le calculo un total». Rule
   * 7 keeps the block's words out and says what to write in their place;
   * rule 8, where the voice is set, turns what the answer does not do into
   * rule 6's remit; rule 6c says its «dígalo» is that remit too.
   */
  it("keeps the derived-figure block's words and a first-person refusal out (#557)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /7\. [^\n]*Tampoco escriba las palabras con que se le entregan las cifras calculadas —«cifra derivada», «etiqueta», «marcador»—: diga la cifra, cómo se cuenta y de qué artículo sale/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /8\. [^\n]*no lo diga en primera persona \(«no calculo su caso», «no le calculo un total», «no la hago aquí»\): diga quién la hace, como una remisión de la regla 6/,
    );
    // 6c's «corríjala o dígalo» opened `ho-abs-calculo-personalizado` with
    // «No puedo darle un total exacto» on every round 1 draw.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6c\. [^\n]*Ese «dígalo» es la remisión misma, no una negativa en primera persona \(regla 8\): no «No puedo darle un total exacto», sino «El monto exacto de su caso lo determina Hacienda»/,
    );
    // The example carries no amount: the system prompt outlives a year's
    // salario base (#505).
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(/¢\d/);
  });

  it("speaks of documentos oficiales, never of RAG-internal material (#75)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/documentos oficiales/i);
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(/fragmento|chunk/i);
    // Rule 2's wire contract survives the register change: the tracker still
    // needs the model to emit [n].
    expect(ANSWER_SYSTEM_PROMPT).toContain("[n]");
  });

  /**
   * #507: rule 7 used to name the eight chunks «los documentos oficiales», so
   * a gap among them read as a gap in the corpus — «los documentos no traen
   * el monto del salario base», four times on #511's lane, though the corpus
   * carries it. The model is told it sees part of the collection, never all
   * of it, and a datum it cannot see goes to rule 9's closing referral. The
   * word «fragmento» stays out (#75), so the model never echoes it.
   */
  it("tells the model it sees part of the documents, never claims one is absent (#507)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /7\. [^\n]*recibe solo algunas partes de los documentos oficiales[^\n]*nunca la colección completa/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /7\. [^\n]*nunca afirme que algo falta en las fuentes: no escriba que los documentos oficiales no traen, no incluyen, no mencionan o no reproducen un documento, un artículo, una tarifa, un monto o una cifra/,
    );
    // A cross-reference: say what the chunk says, refer for the datum at the end.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /7\. [^\n]*diga lo que sí dice, con su cita, sin dar el dato que no ve, y deje para la oración final de la regla 9 que la persona lo confirme con la institución/,
    );
    // Rule 6's «no encuentra base oficial» still answers a question nothing covers.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /7\. [^\n]*Cuando nada de lo que recibió responde la pregunta, rige la regla 6/,
    );
    // Rule 9's referral stays one closing sentence, never the opening (#500's
    // opening report reads it).
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /9\. [^\n]*en una sola oración, al final[^\n]*no la anuncie al principio ni la repita/,
    );
    // No rule asks the model to say the documents lack something.
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(
      /los documentos no precisan|no está en los documentos, dígalo/,
    );
  });

  it("permits only the three constructs AnswerProse renders (#77)", () => {
    // The subset: `- ` bullets, **bold**, simple pipe tables.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/viñetas/i);
    expect(ANSWER_SYSTEM_PROMPT).toContain("**");
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/tablas simples/i);
    // Headings and markdown links are out; every other construct with them.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/No use títulos/);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/enlaces/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/Markdown/);
    // The honest-fallback rule makes the model print bare agency URLs — the formatting rule
    // must forbid link *syntax*, not URLs.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /direcciones web escríbalas tal cual/i,
    );
    // And it must not be readable as overriding rule 2's [n] contract.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no altera la regla 2/i);
  });

  it("makes conflicting sources a stated discrepancy, not a silent pick (#135)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/se contradicen/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/las fuentes discrepan/i);
    // Both sides must survive into the answer: the figure of each source and
    // a citation for each — never one chosen, never an average.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no escoja uno ni promedie/i);
    expect(ANSWER_SYSTEM_PROMPT).toContain("[m]");
  });

  it("exempts one norma at two moments from the discrepancy rule (#182)", () => {
    // A consolidated text beside the law that reformed it is not a live
    // conflict; rule 4 used to report one, and the groundedness judge
    // correctly scored the invented discrepancy as unsupported.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/misma norma en dos momentos/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/texto consolidado/i);
    // The consolidated text is the current one, and it is what the answer
    // must be built from — the earlier wording is not a second source.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/vigente/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no.{0,40}discrepan/i);
    // The two recognisable signals a fragment pair actually carries.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/mismo artículo de la misma norma/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/Así reformado/);
  });

  it("keeps two different normas on the conflict branch (#182 guards #135)", () => {
    // The carve-out is the narrow one: same norma, stated in the fragments.
    // Two decrees with different numbers stay a discrepancy even when one is
    // newer — inferring repeal from recency is exactly what the conflicting
    // sources judge fails an answer for.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/normas distintas/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/aunque una sea más reciente/i);
  });

  it("tells the model to keep consecutive bullets on consecutive lines (#95)", () => {
    // Renderer-side merges blank-line-separated bullets back into one list
    // (issue #95); this prompt-side rule asks the model not to introduce
    // the blank line in the first place.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /viñetas consecutivas van en líneas consecutivas/i,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/sin línea en blanco entre ellas/i);
  });
});

describe("ANSWER_SYSTEM (#413)", () => {
  it("is the system prompt, unchanged, as one cache breakpoint", () => {
    // Every answer call shares these ~4,600 tokens (count_tokens), above the
    // answer model's caching minimum (512 on claude-sonnet-5-5); the chunks
    // after them
    // differ per question and are deliberately left unmarked (a write premium
    // nothing reads).
    expect(ANSWER_SYSTEM).toEqual({
      role: "system",
      content: ANSWER_SYSTEM_PROMPT,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });
  });
});

describe("WEAK_RETRIEVAL_ANSWER", () => {
  it("says no official basis was found and links both agencies", () => {
    expect(WEAK_RETRIEVAL_ANSWER).toContain("No encuentro base oficial");
    expect(WEAK_RETRIEVAL_ANSWER).toContain("https://www.hacienda.go.cr");
    expect(WEAK_RETRIEVAL_ANSWER).toContain("https://www.ccss.sa.cr");
    // No apology theater (DESIGN §9).
    expect(WEAK_RETRIEVAL_ANSWER).not.toMatch(/lo sentimos|disculp/i);
  });

  it("is the general variant of the routed decline (#264)", () => {
    expect(WEAK_RETRIEVAL_ANSWER).toBe(declineAnswer("general"));
  });
});

describe("rule 6 and the routing table (#264)", () => {
  it("takes the two agency URLs from the table", () => {
    expect(HACIENDA_URL).toBe("https://www.hacienda.go.cr");
    expect(CCSS_URL).toBe("https://www.ccss.sa.cr");
  });

  it("lists every institution and URL in the table, and only those", () => {
    for (const entry of ROUTING) {
      expect(ANSWER_SYSTEM_PROMPT).toContain(
        `${entry.institution}: ${entry.url}`,
      );
    }
    // Every URL the prompt can print is one the re-crawl verifies.
    const urls = ANSWER_SYSTEM_PROMPT.match(/https?:\/\/[^\s;,)]+/g) ?? [];
    const known = new Set(ROUTING.map((entry) => entry.url));
    for (const url of urls) {
      expect(known.has(url.replace(/\.$/, ""))).toBe(true);
    }
  });

  it("routes a persona jurídica question even when the fragments cover it (#290)", () => {
    // The three 2026 routing failures all reached the model with fragments in
    // hand; rule 6 alone only bites when the fragments say nothing.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6a\. Persona jurídica\.[\s\S]*aunque los documentos provistos hablen del tema/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toContain(
      `remita al Registro Nacional (${routingEntry("registro-nacional").url})`,
    );
  });

  it("sends a price or a professional question to a person, not a portal (#285)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6b\. Precio y escogencia de un profesional\./,
    );
    expect(ANSWER_SYSTEM_PROMPT).toContain("no hay fuente oficial que lo fije");
    expect(ANSWER_SYSTEM_PROMPT).toContain(routingEntry("contadores").url);
    // Scoped to its own profession: «¿qué abogado me recomienda?» is a rule 6
    // question, not a referral to the contadores' register.
    expect(ANSWER_SYSTEM_PROMPT).toContain(
      "Si la pregunta es por otra profesión, no la envíe ahí",
    );
  });

  it("says that correcting a false premise does not replace routing (#290)", () => {
    // Rule 8(b) leans toward correcting the premise; the 2026 baseline shows
    // an answer that corrected it and then named no institution.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6c\. Corregir no sustituye remitir\./,
    );
    expect(ANSWER_SYSTEM_PROMPT).toContain(
      "Una respuesta que corrige y no remite incumple la regla 6",
    );
  });

  /**
   * #451: Sonnet 5.5 opened 7 of the 2026-09-28 run's 54 Tier 1 answers (both
   * arms) with «No encuentro base oficial» when the documents answered part of
   * the question, and the adequacy judge reads such an answer as a decline. The
   * decline is for a question the documents answer none of; a partial gap is
   * referred at the end.
   */
  it("declines only when the documents answer nothing asked (#451)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6\. Si los documentos provistos no responden nada de lo que la persona preguntó/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6\. [^\n]*Si responden una parte, responda esa parte con sus citas y remita solo por lo que falta, al final/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /6\. [^\n]*no la empiece diciendo que no encuentra base oficial/,
    );
  });

  it("tells the model an out-of-scope institution is out of scope, not unknown", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /fuera de lo que cubre este asistente/,
    );
    // Rule 5 (MTSS) is still an encoded fact, not a routing — stated as the
    // limit of the law rather than as a verdict on the reader's own case.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /5\. Si la pregunta trata de derechos laborales del MTSS/,
    );
    expect(ANSWER_SYSTEM_PROMPT).toContain(
      "no como un veredicto sobre el caso de quien pregunta",
    );
  });
});

describe("buildUserPrompt on the citation retry (#131)", () => {
  const CHUNKS = [chunk()];

  it("says nothing extra on the first attempt", () => {
    expect(
      buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, { today: TODAY }),
    ).toBe(
      buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, {
        today: TODAY,
        citationRetry: false,
      }),
    );
  });

  it("appends the correction after the documents, so it is the last thing read", () => {
    const retry = buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, {
      today: TODAY,
      citationRetry: true,
    });

    expect(retry).toContain(CITATION_RETRY_NOTE);
    expect(retry.endsWith(CITATION_RETRY_NOTE)).toBe(true);
    // The retry is the same ask with a correction on it — the question and the
    // documents must be identical, or we are answering a different question.
    expect(
      retry.startsWith(
        buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, { today: TODAY }),
      ),
    ).toBe(true);
  });

  it("points the model at the rules it already has, not a new one", () => {
    // Rule 2 is the citation rule and rule 6 the honest-decline rule; a retry
    // that invented its own vocabulary would compete with the system prompt.
    expect(CITATION_RETRY_NOTE).toContain("regla 2");
    expect(CITATION_RETRY_NOTE).toContain("regla 6");
    expect(ANSWER_SYSTEM_PROMPT).toContain("2. Cite cada afirmación");
  });

  it("names the artículo-number marker on the retry (#352)", () => {
    // The one invariant violation of the run after #411 was a closed «[47]» for
    // «artículo 47»; a note that only says «ningún otro número es válido»
    // leaves the model to rediscover which number it got wrong.
    expect(CITATION_RETRY_NOTE).toMatch(/número de un artículo/);
  });

  it("says a marker holds the number and nothing else on the retry (#427)", () => {
    // Two of the 2026-09-25 lane's violations were «[10 no existe, cito 6]»
    // and «[7][10 nota: cita 7]»: a retry that only says which numbers are
    // valid leaves the annotation itself unnamed.
    expect(CITATION_RETRY_NOTE).toMatch(
      /cada \[n\] lleva el número del documento y nada más/,
    );
    expect(CITATION_RETRY_NOTE).toMatch(
      /ninguna palabra, nota ni corrección entre los corchetes/,
    );
    expect(CITATION_RETRY_NOTE).toMatch(
      /no lo comente ni lo corrija entre corchetes: escriba la oración con el número correcto/,
    );
  });
});
