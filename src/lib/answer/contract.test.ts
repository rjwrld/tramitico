import { describe, expect, it } from "vitest";
import type { Citation } from "@/lib/retrieval";
import {
  askErrorMessage,
  askRequestBody,
  ASK_FALLBACK_ERROR_MESSAGE,
  boundTurns,
  citationsFrom,
  conversationTurns,
  MAX_HISTORY_TURNS,
  MAX_TURN_ANSWER_CHARS,
  MAX_TURN_QUESTION_CHARS,
  messageText,
  unsavedFrom,
  type AskUIMessage,
} from "@/lib/answer/contract";

const cite = (docKey: string, articulo: string | null): Citation => ({
  docKey,
  docTitle: docKey,
  norma: null,
  articulo,
  url: `https://example.com/${docKey}`,
});

describe("messageText", () => {
  it("joins the text parts and ignores everything else", () => {
    const message: AskUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "El IVA " },
        { type: "data-citations", data: [cite("ley-iva", "Artículo 8")] },
        { type: "text", text: "no aplica." },
      ],
    };
    expect(messageText(message)).toBe("El IVA no aplica.");
  });
});

describe("citationsFrom", () => {
  it("returns the latest citations snapshot", () => {
    const message: AskUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "data-citations", data: [cite("ley-iva", "Artículo 8")] },
        {
          type: "data-citations",
          data: [
            cite("ley-iva", "Artículo 8"),
            cite("reglamento-iva", "Artículo 11"),
          ],
        },
      ],
    };
    expect(citationsFrom(message).map((c) => c.docKey)).toEqual([
      "ley-iva",
      "reglamento-iva",
    ]);
  });

  it("returns [] when no citations streamed (honest fallback answers)", () => {
    const message: AskUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "No encuentro base oficial." }],
    };
    expect(citationsFrom(message)).toEqual([]);
  });
});

describe("unsavedFrom (#139)", () => {
  it("reports the answer as unsaved once the part arrives", () => {
    const message: AskUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Aplica el 13%." },
        { type: "data-unsaved", data: true },
      ],
    };
    expect(unsavedFrom(message)).toBe(true);
  });

  it("is false when no part streamed — a saved answer, or a restored one, says nothing", () => {
    const message: AskUIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Aplica el 13%." }],
    };
    expect(unsavedFrom(message)).toBe(false);
  });
});

describe("askErrorMessage", () => {
  it("surfaces the friendly ES message from a JSON error body", () => {
    const body = JSON.stringify({
      error: "rate_limited",
      message: "Alcanzó el límite de 10 preguntas gratis por hoy.",
    });
    expect(askErrorMessage(new Error(body))).toBe(
      "Alcanzó el límite de 10 preguntas gratis por hoy.",
    );
  });

  it("falls back to the generic connection message otherwise", () => {
    expect(askErrorMessage(new Error("<html>502</html>"))).toBe(
      ASK_FALLBACK_ERROR_MESSAGE,
    );
    expect(askErrorMessage(new Error(JSON.stringify({ error: "boom" })))).toBe(
      ASK_FALLBACK_ERROR_MESSAGE,
    );
    expect(askErrorMessage(undefined)).toBe(ASK_FALLBACK_ERROR_MESSAGE);
  });
});

/** One message with a single text part — the shape the thread renders. */
const msg = (
  id: string,
  role: "user" | "assistant",
  text: string,
): AskUIMessage => ({ id, role, parts: [{ type: "text", text }] });

/** A finished exchange: the question, then the answer to it. */
const exchange = (n: number): AskUIMessage[] => [
  msg(`u${n}`, "user", `¿Pregunta ${n}?`),
  msg(`a${n}`, "assistant", `Respuesta ${n}.`),
];

describe("boundTurns (#132)", () => {
  it("keeps only the last MAX_HISTORY_TURNS exchanges, oldest first", () => {
    const turns = [1, 2, 3, 4, 5].map((n) => ({
      question: `¿Pregunta ${n}?`,
      answer: `Respuesta ${n}.`,
    }));

    const bounded = boundTurns(turns);

    expect(bounded).toHaveLength(MAX_HISTORY_TURNS);
    expect(bounded[0].question).toBe("¿Pregunta 3?");
    expect(bounded.at(-1)!.question).toBe("¿Pregunta 5?");
  });

  it("clamps each half and marks where it cut", () => {
    const [turn] = boundTurns([
      {
        question: `${"pregunta ".repeat(400)}final`,
        answer: `${"respuesta ".repeat(400)}final`,
      },
    ]);

    expect(turn.question.length).toBeLessThanOrEqual(
      MAX_TURN_QUESTION_CHARS + 1,
    );
    expect(turn.answer.length).toBeLessThanOrEqual(MAX_TURN_ANSWER_CHARS + 1);
    expect(turn.question.endsWith("…")).toBe(true);
    expect(turn.answer.endsWith("…")).toBe(true);
  });

  it("drops anything that is not a pair of non-empty strings", () => {
    // The server calls this on a parsed request body, so the shapes a
    // hand-rolled POST can send have to leave rather than throw.
    expect(
      boundTurns([
        null,
        "¿Pregunta?",
        { question: "¿Pregunta?" },
        { question: "¿Pregunta?", answer: "   " },
        { question: 7, answer: "Respuesta." },
        { question: "¿Pregunta?", answer: "Respuesta." },
      ]),
    ).toEqual([{ question: "¿Pregunta?", answer: "Respuesta." }]);
  });
});

describe("conversationTurns (#132)", () => {
  it("is empty on a first turn", () => {
    expect(conversationTurns([msg("u1", "user", "¿Pregunta 1?")])).toEqual([]);
    expect(conversationTurns([])).toEqual([]);
  });

  it("pairs each earlier question with the answer it got", () => {
    const messages = [
      ...exchange(1),
      ...exchange(2),
      msg("u3", "user", "¿y si también soy asalariado?"),
    ];

    expect(conversationTurns(messages)).toEqual([
      { question: "¿Pregunta 1?", answer: "Respuesta 1." },
      { question: "¿Pregunta 2?", answer: "Respuesta 2." },
    ]);
  });

  it("excludes the question being asked, even mid-stream", () => {
    // The assistant message exists but has no text yet — the exchange in
    // flight is not a turn to condense against.
    const messages = [
      ...exchange(1),
      msg("u2", "user", "¿y si también soy asalariado?"),
      msg("a2", "assistant", ""),
    ];

    expect(conversationTurns(messages)).toEqual([
      { question: "¿Pregunta 1?", answer: "Respuesta 1." },
    ]);
  });

  it("skips a question whose answer never arrived", () => {
    // A failed ask (#74): the user message is there, the assistant message
    // never started. Half a turn resolves no antecedent.
    const messages = [
      msg("u1", "user", "¿Pregunta 1?"),
      ...exchange(2),
      msg("u3", "user", "¿y eso?"),
    ];

    expect(conversationTurns(messages)).toEqual([
      { question: "¿Pregunta 2?", answer: "Respuesta 2." },
    ]);
  });
});

describe("askRequestBody (#132)", () => {
  it("sends a first turn with no history key at all", () => {
    expect(askRequestBody([msg("u1", "user", "¿Cuánto es el IVA?")])).toEqual({
      question: "¿Cuánto es el IVA?",
    });
  });

  it("sends the follow-up with the window behind it", () => {
    const body = askRequestBody([
      ...exchange(1),
      msg("u2", "user", "¿y si también soy asalariado?"),
    ]);

    expect(body).toEqual({
      question: "¿y si también soy asalariado?",
      history: [{ question: "¿Pregunta 1?", answer: "Respuesta 1." }],
    });
  });
});
