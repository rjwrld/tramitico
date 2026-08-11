import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  formatChunks,
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
    // Rule 5 makes the model print bare agency URLs — the formatting rule
    // must forbid link *syntax*, not URLs.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(
      /direcciones web escríbalas tal cual/i,
    );
    // And it must not be readable as overriding rule 2's [n] contract.
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/no altera la regla 2/i);
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
});
