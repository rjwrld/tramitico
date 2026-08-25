import { describe, expect, it } from "vitest";
import type { Citation } from "@/lib/retrieval";
import {
  askErrorMessage,
  ASK_FALLBACK_ERROR_MESSAGE,
  citationsFrom,
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
