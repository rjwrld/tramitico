import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { checkAnswer } from "./answer-checks";
import type { EvalCase } from "./dataset";
import {
  droppedReadingsSummary,
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
  generation: {
    finishReason: "stop",
    outputTokens: 1_412,
    today: "2026-09-29",
  },
  rerank: {
    asked: 3,
    returned: 2,
    dropped: [{ reading: "step", cause: "http", status: 429 }],
  },
  checks: checkAnswer("Las rentas de hasta ¢6.244.000 no están sujetas [1].", [
    chunk({}),
  ]),
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
      // The date the answer was written against (#455).
      generation: {
        finishReason: "stop",
        outputTokens: 1_412,
        today: "2026-09-29",
      },
    });
  });

  it("carries #500's checks on the answer", () => {
    expect(ROW.checks).toEqual({
      absence: { falseClaims: [], opening: null },
      typos: [],
    });
  });

  it("states how many rerank readings the case lost, and why (#466)", () => {
    expect(ROW.rerank).toEqual({
      asked: 3,
      returned: 2,
      dropped: [{ reading: "step", cause: "http", status: 429 }],
    });
  });

  it("records no failure label and no re-asks unless the lane gave them (#474)", () => {
    expect(ROW.groundedness.label).toBeNull();
    expect(ROW.reasks).toEqual([]);
  });

  it("records a blocking case's re-asks, each with its own chunks and label (#474)", () => {
    const row = transcriptRow({
      evalCase: CASE,
      query: CASE.question,
      answer: "Primera [1].",
      chunks: [chunk({})],
      derivedFigures: [],
      groundedness: {
        verdict: "fail",
        verdicts: ["fail", "fail", "fail"],
        reason: "wrong rate",
        label: { label: "contradiction", reason: "[1] says 10 %" },
      },
      citations: { ok: true },
      adequacy: null,
      generation: null,
      rerank: null,
      checks: null,
      reasks: [
        {
          query: CASE.question,
          answer: "Segunda [1].",
          chunks: [chunk({ chunkId: "c9" })],
          derivedFigures: [],
          groundedness: { verdict: "pass", verdicts: ["pass"], reason: "" },
          checks: null,
          generation: null,
          rerank: null,
        },
      ],
    });
    expect(row.groundedness.label).toEqual({
      label: "contradiction",
      reason: "[1] says 10 %",
    });
    expect(row.reasks).toHaveLength(1);
    expect(Object.keys(row.reasks[0]).sort()).toEqual([
      "answer",
      "checks",
      "chunks",
      "derivedFigures",
      "generation",
      "groundedness",
      "query",
      "rerank",
    ]);
    expect(row.reasks[0]).toMatchObject({
      answer: "Segunda [1].",
      chunks: [{ marker: 1, chunkId: "c9" }],
      groundedness: {
        verdict: "pass",
        verdicts: ["pass"],
        reason: "",
        label: null,
      },
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
      {
        marker: 1,
        chunkId: "c1",
        docKey: "tramos-renta-2026",
        articulo: "Artículo 1",
        content: "…",
      },
      {
        marker: 2,
        chunkId: "c2",
        docKey: "ley-renta",
        articulo: "Artículo 1",
        content: "…",
      },
    ]);
  });

  /**
   * `docKey` + `articulo` does not identify a chunk — a long artículo is
   * chunked into parts that share both — and the question the transcript
   * exists to answer is whether the text a requirement needed was in the
   * prompt at all. Without the content that is unanswerable offline, which
   * is the re-run this file exists to avoid.
   */
  it("keeps each chunk's id and text, so a requirement can be looked for in it", () => {
    const row = transcriptRow({
      evalCase: CASE,
      query: CASE.question,
      answer: "…",
      chunks: [
        chunk({ chunkId: "a", part: 0, content: "primera parte del artículo" }),
        chunk({ chunkId: "b", part: 1, content: "segunda parte del artículo" }),
      ],
      derivedFigures: [],
      groundedness: { verdict: "pass", verdicts: ["pass"], reason: "" },
      citations: { ok: true },
      adequacy: null,
      generation: {
        finishReason: "stop",
        outputTokens: null,
        today: "2026-09-29",
      },
      rerank: { asked: 1, returned: 1, dropped: [] },
      checks: null,
    });
    // Same docKey and articulo on both: only the id and the text tell them
    // apart.
    expect(row.chunks.map((c) => c.chunkId)).toEqual(["a", "b"]);
    expect(row.chunks[1]!.content).toBe("segunda parte del artículo");
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
      generation: null,
      rerank: null,
      checks: null,
    });
    expect(declined.chunks).toEqual([]);
    expect(declined.generation).toBeNull();
    // Never reranked, so nothing could be lost (#466).
    expect(declined.rerank).toBeNull();
    expect(declined.citations).toBeNull();
    expect(declined.adequacy).toBeNull();
  });
});

describe("droppedReadingsSummary (#466)", () => {
  it("says a clean run lost none, out of every reading it asked for", () => {
    expect(
      droppedReadingsSummary([
        { id: "a", rerank: { asked: 2, returned: 2, dropped: [] } },
        { id: "b", rerank: null },
        { id: "c", rerank: { asked: 7, returned: 7, dropped: [] } },
      ]),
    ).toBe("rerank readings lost: none of 9");
  });

  it("names each case that lost one, with the reading and its status or cause", () => {
    expect(
      droppedReadingsSummary([
        {
          id: "a",
          rerank: {
            asked: 3,
            returned: 1,
            dropped: [
              { reading: "question", cause: "http", status: 429 },
              { reading: "step", cause: "timeout", status: null },
            ],
          },
        },
        { id: "b", rerank: { asked: 2, returned: 2, dropped: [] } },
        {
          id: "c",
          rerank: {
            asked: 2,
            returned: 1,
            dropped: [{ reading: "expansion", cause: "http", status: 503 }],
          },
        },
      ]),
    ).toBe(
      "rerank readings lost: 3 of 7, on 2 case(s) — " +
        "a(question:429,step:timeout) c(expansion:503)",
    );
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

  it("marks a subset run, so it cannot be read as the full one beside it", () => {
    expect(
      transcriptFilename("claude-sonnet-5", new Date("2026-09-05T02:55:03Z"), {
        subset: true,
      }),
    ).toBe("groundedness-claude-sonnet-5-subset-20260905T025503Z.jsonl");
  });
});

describe("writeTranscript", () => {
  /**
   * The transcript is the product of a run that costs real money and half an
   * hour. Two runs landing in the same second — the stamp has no fractional
   * part — must not leave one of them silently truncated by the other.
   */
  it("never overwrites an earlier transcript for the same instant", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tx-"));
    const at = { dir, answerModel: "m", now: new Date("2026-09-05T02:55:03Z") };
    const first = writeTranscript([ROW], at);
    const second = writeTranscript([{ ...ROW, id: "otro-caso" }], at);

    expect(second).not.toBe(first);
    expect(JSON.parse(readFileSync(first, "utf8").trim()).id).toBe(
      "ho-minimo-renta-2026",
    );
    expect(JSON.parse(readFileSync(second, "utf8").trim()).id).toBe(
      "otro-caso",
    );
  });

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
