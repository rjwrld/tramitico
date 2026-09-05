import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import type { EvalCase } from "./dataset";
import {
  serializeTranscript,
  transcriptFilename,
  transcriptRow,
  writeTranscript,
  type TranscriptRow,
} from "./transcript";

const CASE: EvalCase = {
  id: "ho-minimo-renta-2026",
  seed: "held-out:T1-E",
  question: "¿Cuánto es el mínimo de renta que no paga en 2026?",
  expected: [{ docKey: "tramos-renta-2026" }],
  blocking: true,
  tier: 1,
  heldOut: true,
  variant: "coloquial",
  family: "T1-E",
};

function chunk(overrides: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    chunkId: "c1",
    docKey: "tramos-renta-2026",
    docTitle: "Tramos de renta 2026",
    norma: "Decreto 45333-H",
    articulo: "Artículo 1",
    path: [],
    part: 0,
    content: "…",
    source: { url: "https://example.test" },
    fetchedAt: "2026-02-01T10:00:00Z",
    score: 0.03,
    vectorRank: 1,
    lexicalRank: 1,
    ...overrides,
  };
}

const ROW: TranscriptRow = transcriptRow({
  evalCase: CASE,
  query: "¿Cuál es el mínimo exento de renta en 2026?",
  answer: "Las rentas de hasta ¢6.244.000 no están sujetas [1].",
  chunks: [chunk({}), chunk({ chunkId: "c2", docKey: "ley-renta" })],
  derivedFigures: [],
  groundedness: { verdict: "pass", verdicts: ["pass"], reason: "" },
  citations: { ok: true },
  adequacy: { verdict: "fail", missing: ["Dónde se consultan"], literals: [] },
});

describe("transcriptRow", () => {
  it("carries what a classification read needs: the case, the answer, the chunks", () => {
    expect(ROW).toMatchObject({
      id: "ho-minimo-renta-2026",
      tier: 1,
      family: "T1-E",
      variant: "coloquial",
      seed: "held-out:T1-E",
      question: CASE.question,
      query: "¿Cuál es el mínimo exento de renta en 2026?",
      answer: "Las rentas de hasta ¢6.244.000 no están sujetas [1].",
      adequacy: { verdict: "fail", missing: ["Dónde se consultan"] },
    });
  });

  /**
   * The whole point of #289 req. 1 is that "the answer omitted it" and "the
   * chunk was never in the top-8" look identical in the printed table. The
   * ranked docKeys are what separates them, so the row keeps them in the
   * order the prompt numbered — a citation marker [n] indexes straight into
   * this list.
   */
  it("numbers the chunks the way the prompt did, so [n] indexes into them", () => {
    expect(ROW.chunks).toEqual([
      { marker: 1, docKey: "tramos-renta-2026", articulo: "Artículo 1" },
      { marker: 2, docKey: "ley-renta", articulo: "Artículo 1" },
    ]);
  });

  it("keeps a weak-retrieval decline, which has no chunks and no citations", () => {
    const declined = transcriptRow({
      evalCase: CASE,
      query: CASE.question,
      answer: "No encuentro base oficial…",
      chunks: [],
      derivedFigures: [],
      groundedness: {
        verdict: "pass",
        verdicts: [],
        reason: "weak-retrieval fallback (no model call)",
      },
      citations: null,
      adequacy: null,
    });
    expect(declined.chunks).toEqual([]);
    expect(declined.citations).toBeNull();
    expect(declined.adequacy).toBeNull();
  });
});

describe("serializeTranscript", () => {
  it("writes one JSON object per line, newline-terminated", () => {
    const jsonl = serializeTranscript([ROW, ROW]);
    const lines = jsonl.split("\n");
    expect(jsonl.endsWith("\n")).toBe(true);
    expect(lines.filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe("ho-minimo-renta-2026");
  });

  it("puts no newline inside a row, whatever the answer contains", () => {
    const jsonl = serializeTranscript([
      { ...ROW, answer: "Primer párrafo.\n\nSegundo párrafo [1]." },
    ]);
    expect(jsonl.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(jsonl).answer).toContain("\n\n");
  });
});

describe("transcriptFilename", () => {
  it("names the run by the answer model and the instant, so runs never collide", () => {
    expect(
      transcriptFilename("claude-sonnet-5", new Date("2026-09-05T02:55:03Z")),
    ).toBe("groundedness-claude-sonnet-5-20260905T025503Z.jsonl");
  });

  it("keeps a model id with a slash out of the path", () => {
    expect(
      transcriptFilename(
        "anthropic/claude-sonnet-5",
        new Date("2026-09-05T02:55:03Z"),
      ),
    ).toBe("groundedness-anthropic-claude-sonnet-5-20260905T025503Z.jsonl");
  });
});

describe("writeTranscript", () => {
  it("creates the directory and returns the path it wrote", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "tx-")), "nested");
    const written = writeTranscript([ROW], {
      dir,
      answerModel: "claude-sonnet-5",
      now: new Date("2026-09-05T02:55:03Z"),
    });
    expect(written).toBe(
      path.join(dir, "groundedness-claude-sonnet-5-20260905T025503Z.jsonl"),
    );
    expect(JSON.parse(readFileSync(written, "utf8").trim()).id).toBe(
      "ho-minimo-renta-2026",
    );
  });
});
