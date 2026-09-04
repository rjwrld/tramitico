import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { declineAnswer, ROUTING } from "../routing";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  CCSS_URL,
  CITATION_RETRY_NOTE,
  formatChunks,
  HACIENDA_URL,
  WEAK_RETRIEVAL_ANSWER,
} from "./prompt";

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
