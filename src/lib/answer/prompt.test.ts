import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { declineAnswer, ROUTING } from "../routing";
import type { ResolvedDerivedFigure } from "./derived";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  CCSS_URL,
  CITATION_RETRY_NOTE,
  formatDerivedFigures,
  formatChunks,
  HACIENDA_URL,
  WEAK_RETRIEVAL_ANSWER,
} from "./prompt";

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
    const prompt = buildUserPrompt("¿Cuánto es el IVA?", [chunk()]);
    expect(prompt).toContain("¿Cuánto es el IVA?");
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("13%");
  });

  it("labels the provided material as documentos oficiales (#75)", () => {
    const prompt = buildUserPrompt("¿Cuánto es el IVA?", [chunk()]);
    expect(prompt).toContain("Documentos oficiales");
    expect(prompt).not.toMatch(/fragmento|chunk/i);
  });

  it("appends system-calculated figures with their input markers", () => {
    const prompt = buildUserPrompt("¿Cuánto pago?", [chunk(), chunk()], {
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
      buildUserPrompt("¿Cuánto pago?", [chunk()], { derivedFigures: [] }),
    ).not.toContain("Cifras derivadas");
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
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/sanción/i);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /aunque la persona no lo haya preguntado/i,
    );
  });

  it("keeps the enumeration rule inside the sources (#289 vs rule 1)", () => {
    // The rule must say, in its own text, that it adds nothing the documents
    // do not carry — otherwise it reads as licence to complete a list.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no complete/i);
  });

  it("speaks of documentos oficiales, never of RAG-internal material (#75)", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/documentos oficiales/i);
    expect(ANSWER_SYSTEM_PROMPT).not.toMatch(/fragmento|chunk/i);
    // Rule 2's wire contract survives the register change: the tracker still
    // needs the model to emit [n].
    expect(ANSWER_SYSTEM_PROMPT).toContain("[n]");
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

  it("tells the model an out-of-scope institution is out of scope, not unknown", () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /fuera de lo que cubre este asistente/,
    );
    // Rule 5 (MTSS) is untouched: still an encoded fact, not a routing.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /5\. Si la pregunta trata de derechos laborales del MTSS/,
    );
  });
});

describe("buildUserPrompt on the citation retry (#131)", () => {
  const CHUNKS = [chunk()];

  it("says nothing extra on the first attempt", () => {
    expect(buildUserPrompt("¿Cuánto es el IVA?", CHUNKS)).toBe(
      buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, { citationRetry: false }),
    );
  });

  it("appends the correction after the documents, so it is the last thing read", () => {
    const retry = buildUserPrompt("¿Cuánto es el IVA?", CHUNKS, {
      citationRetry: true,
    });

    expect(retry).toContain(CITATION_RETRY_NOTE);
    expect(retry.endsWith(CITATION_RETRY_NOTE)).toBe(true);
    // The retry is the same ask with a correction on it — the question and the
    // documents must be identical, or we are answering a different question.
    expect(
      retry.startsWith(buildUserPrompt("¿Cuánto es el IVA?", CHUNKS)),
    ).toBe(true);
  });

  it("points the model at the rules it already has, not a new one", () => {
    // Rule 2 is the citation rule and rule 6 the honest-decline rule; a retry
    // that invented its own vocabulary would compete with the system prompt.
    expect(CITATION_RETRY_NOTE).toContain("regla 2");
    expect(CITATION_RETRY_NOTE).toContain("regla 6");
    expect(ANSWER_SYSTEM_PROMPT).toContain("2. Cite cada afirmación");
  });
});
