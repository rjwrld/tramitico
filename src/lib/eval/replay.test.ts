import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "../answer/prompt";
import type { EvalCase } from "./dataset";
import {
  coverageDelta,
  parseTranscript,
  replayChunks,
  replayPlan,
  type ChunkDocMeta,
} from "./replay";
import type { TranscriptRow } from "./transcript";

function evalCase(overrides: Partial<EvalCase>): EvalCase {
  return {
    id: "ho-iva-en-cero-sin-facturar",
    seed: "held-out:T1-D",
    question: "¿Tengo que presentar el IVA en cero si no facturé este mes?",
    expected: [{ docKey: "ley-iva" }],
    blocking: false,
    tier: 1,
    heldOut: true,
    variant: "coloquial",
    family: "T1-D",
    requiredClaims: [
      { claim: "Sí: la declaración se presenta aunque no haya ventas." },
      { claim: "Se presenta mensualmente." },
    ],
    requiredSteps: ["Dónde se presenta la declaración hoy."],
    ...overrides,
  };
}

function row(overrides: Partial<TranscriptRow>): TranscriptRow {
  return {
    id: "ho-iva-en-cero-sin-facturar",
    tier: 1,
    family: "T1-D",
    variant: "coloquial",
    seed: "held-out:T1-D",
    heldOut: true,
    question: "¿Tengo que presentar el IVA en cero si no facturé este mes?",
    query: "¿Tengo que presentar el IVA en cero si no facturé este mes?",
    answer: "Sí [1].",
    chunks: [
      {
        marker: 1,
        chunkId: "c-ley",
        docKey: "ley-iva",
        articulo: "Artículo 27",
        content: "Los contribuyentes deberán presentar la declaración…",
      },
      {
        marker: 2,
        chunkId: "c-faq",
        docKey: "hacienda-faq",
        articulo: null,
        content: "Pregunta: ¿debo declarar en cero?",
      },
    ],
    derivedFigures: [],
    groundedness: { verdict: "pass", verdicts: ["pass"], reason: "ok" },
    citations: { ok: true },
    adequacy: {
      verdict: "fail",
      missing: ["Dónde se presenta la declaración hoy."],
      literals: [],
    },
    generation: {
      finishReason: "stop",
      outputTokens: 700,
      today: "2026-09-29",
    },
    rerank: { asked: 2, returned: 2, dropped: [] },
    ...overrides,
  };
}

const META: ReadonlyMap<string, ChunkDocMeta> = new Map([
  [
    "c-ley",
    { title: "Ley del Impuesto sobre el Valor Agregado", norma: "Ley 6826" },
  ],
  ["c-faq", { title: "Preguntas frecuentes IVA", norma: null }],
]);

describe("replayChunks", () => {
  it("rebuilds the chunks in marker order, with the title and norma the transcript leaves out", () => {
    const chunks = replayChunks(row({}), META);
    expect(chunks.map((c) => c.chunkId)).toEqual(["c-ley", "c-faq"]);
    expect(chunks[0]).toMatchObject({
      docKey: "ley-iva",
      docTitle: "Ley del Impuesto sobre el Valor Agregado",
      norma: "Ley 6826",
      articulo: "Artículo 27",
      content: "Los contribuyentes deberán presentar la declaración…",
    });
  });

  it("numbers the prompt exactly as the recorded run did", () => {
    const prompt = buildUserPrompt(
      "¿Declaro en cero?",
      replayChunks(row({}), META),
      { today: "2026-09-29" },
    );
    expect(prompt).toContain(
      "[1] Ley del Impuesto sobre el Valor Agregado — Artículo 27 (Ley 6826)\nLos contribuyentes",
    );
    expect(prompt).toContain("[2] Preguntas frecuentes IVA\nPregunta:");
  });

  it("throws when the markers do not run 1..n, rather than renumbering them", () => {
    // A gap would shift every [n] after it, and the recorded answer's markers
    // would point at different documents than the replayed one's.
    const gapped = row({});
    gapped.chunks[1] = { ...gapped.chunks[1], marker: 3 };
    expect(() => replayChunks(gapped, META)).toThrow(
      /ho-iva-en-cero-sin-facturar.*1\.\.2/,
    );
  });

  it("throws, naming the case and the chunk, when the corpus no longer carries a chunk", () => {
    // A re-ingest mints new ids: replaying against it would put a different
    // prompt in front of the model while the output claimed the recorded one.
    expect(() =>
      replayChunks(row({}), new Map([["c-ley", META.get("c-ley")!]])),
    ).toThrow(/ho-iva-en-cero-sin-facturar.*c-faq/);
  });
});

describe("parseTranscript", () => {
  it("reads one row per non-blank line", () => {
    const text = `${JSON.stringify(row({}))}\n\n${JSON.stringify(row({ id: "b" }))}\n`;
    expect(parseTranscript(text).map((r) => r.id)).toEqual([
      "ho-iva-en-cero-sin-facturar",
      "b",
    ]);
  });
});

describe("replayPlan", () => {
  const dataset = [
    evalCase({}),
    evalCase({ id: "t2", tier: 2, family: undefined, variant: undefined }),
    evalCase({ id: "declined" }),
  ];
  const rows = [
    row({}),
    row({ id: "t2", tier: 2 }),
    // A weak-retrieval decline made no model call, so there is no prompt to
    // replay.
    row({ id: "declined", chunks: [] }),
  ];

  it("pairs every row that had a prompt with its case", () => {
    expect(
      replayPlan(rows, dataset, { cases: null, tier: null }).map(
        (p) => p.evalCase.id,
      ),
    ).toEqual(["ho-iva-en-cero-sin-facturar", "t2"]);
  });

  it("narrows to a tier", () => {
    expect(
      replayPlan(rows, dataset, { cases: null, tier: 1 }).map((p) => p.row.id),
    ).toEqual(["ho-iva-en-cero-sin-facturar"]);
  });

  it("narrows to named cases", () => {
    expect(
      replayPlan(rows, dataset, { cases: ["t2"], tier: null }).map(
        (p) => p.row.id,
      ),
    ).toEqual(["t2"]);
  });

  it("throws on a named case the transcript does not carry — before any paid call", () => {
    expect(() =>
      replayPlan(rows, dataset, { cases: ["t2", "typo"], tier: null }),
    ).toThrow(/typo/);
  });

  it("throws when nothing is left to replay — before any paid call", () => {
    expect(() => replayPlan(rows, dataset, { cases: ["t2"], tier: 1 })).toThrow(
      /nothing to replay/,
    );
  });

  it("throws on a row whose case the dataset no longer has", () => {
    expect(() =>
      replayPlan([row({ id: "gone" })], dataset, { cases: null, tier: null }),
    ).toThrow(/gone/);
  });
});

describe("coverageDelta", () => {
  it("counts requirements stated before and after, per case and summed", () => {
    const c = evalCase({});
    const delta = coverageDelta([
      {
        evalCase: c,
        before: { missing: ["a", "b"], literals: [] },
        after: { missing: [], literals: [] },
      },
    ]);
    expect(delta.before).toEqual({ stated: 1, total: 3 });
    expect(delta.after).toEqual({ stated: 3, total: 3 });
    expect(delta.cases).toEqual([{ id: c.id, before: 1, after: 3, total: 3 }]);
  });

  it("counts a failed literal as a requirement not stated", () => {
    const delta = coverageDelta([
      {
        evalCase: evalCase({}),
        before: { missing: [], literals: [] },
        after: { missing: [], literals: ["«mensual» not found"] },
      },
    ]);
    expect(delta.after.stated).toBe(2);
  });
});
