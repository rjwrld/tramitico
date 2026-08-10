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
