import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCcssFaqChunks,
  faqCountMessage,
  fetchCcssFaq,
} from "./ccss-faq";
import type { FetchLike } from "./official-http";

const PAGE_URL = "https://www.ccss.sa.cr/preguntas-frecuentes";
const fixture = readFileSync(
  path.resolve(__dirname, "__fixtures__/ccss-faq-modals.html"),
  "utf8",
);

describe("extractCcssFaqChunks", () => {
  it("extracts one chunk per relevant question with its category as path", () => {
    const chunks = extractCcssFaqChunks(
      "ccss-faq",
      "CCSS — Preguntas frecuentes",
      fixture,
      PAGE_URL,
      3,
    );

    expect(chunks).toHaveLength(3);
    expect(chunks.map(({ articulo, path }) => ({ articulo, path }))).toEqual([
      {
        articulo: "¿Debo asegurarme?",
        path: ["Trabajador Independiente"],
      },
      { articulo: "¿Cómo formalizo un arreglo?", path: ["Cobros"] },
      { articulo: "¿Dónde veo la tabla?", path: ["Seguro voluntario"] },
    ]);
    expect(chunks[0].content).toContain(
      "Sí, cuando realiza una actividad generadora de ingresos.",
    );
    expect(chunks[1].content).toContain(
      "requisitos (https://www.ccss.sa.cr/requisitos)",
    );
  });

  it("turns an image-only answer into explicit linked text", () => {
    const chunks = extractCcssFaqChunks(
      "ccss-faq",
      "CCSS — Preguntas frecuentes",
      fixture,
      PAGE_URL,
      3,
    );

    expect(chunks[2].content).toContain(
      "respuesta oficial está publicada como imagen",
    );
    expect(chunks[2].content).toContain(
      "https://www.ccss.sa.cr/assets/img/faq/cuotas.png",
    );
  });

  it("fails before ingestion when the relevant-question floor is missed", () => {
    expect(() =>
      extractCcssFaqChunks(
        "ccss-faq",
        "CCSS — Preguntas frecuentes",
        fixture,
        PAGE_URL,
        4,
      ),
    ).toThrow(/found 3 relevant FAQ questions; expected at least 4/);
  });
});

describe("fetchCcssFaq", () => {
  it("sends the browser User-Agent used by the official-source fetchers", async () => {
    const fake = vi.fn<FetchLike>(async () => new Response("<html>ok</html>"));
    await fetchCcssFaq(PAGE_URL, fake);
    const headers = fake.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("fails loudly on a 403", async () => {
    const fake = vi.fn<FetchLike>(
      async () => new Response("Forbidden", { status: 403 }),
    );
    await expect(fetchCcssFaq(PAGE_URL, fake)).rejects.toThrow(
      /HTTP 403.*User-Agent rejected/,
    );
  });
});

describe("faqCountMessage", () => {
  it("reports the change from the cached crawl", () => {
    expect(faqCountMessage(42, 39)).toBe(
      "42 relevant questions (change from cached crawl: +3)",
    );
  });
});
