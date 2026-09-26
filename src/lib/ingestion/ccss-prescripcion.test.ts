import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCcssPrescripcionChunks,
  fetchCcssPrescripcion,
  headingCountMessage,
} from "./ccss-prescripcion";
import type { FetchLike } from "./official-http";

const PAGE_URL = "https://www.ccss.sa.cr/web/prescripcion/";
const fixture = readFileSync(
  path.resolve(__dirname, "__fixtures__/ccss-prescripcion.html"),
  "utf8",
);

describe("extractCcssPrescripcionChunks", () => {
  it("creates one chunk per visible heading and merges repeated headings", () => {
    const chunks = extractCcssPrescripcionChunks(
      "ccss-prescripcion",
      "CCSS — Prescripción de deudas",
      fixture,
      PAGE_URL,
      4,
    );

    expect(chunks.map(({ articulo, path }) => ({ articulo, path }))).toEqual([
      {
        articulo: "¿Cómo se solicita la prescripción?",
        path: ["Guía"],
      },
      { articulo: "¿Cuáles son los plazos?", path: ["Guía"] },
      { articulo: "¿Cuánto tarda?", path: ["Preguntas frecuentes"] },
      { articulo: "¿Dónde la presento?", path: ["Preguntas frecuentes"] },
    ]);
    expect(chunks[0].content).toContain("nombre e identificación");
    expect(chunks[0].content).toContain("periodos que solicita");
    expect(chunks[0].content).toContain("https://www.ccss.sa.cr/oficinas");
    expect(chunks[2].content).toContain("20 días hábiles");
    expect(chunks[3].content).toContain("Envíela a cobros@ccss.sa.cr.");
    expect(chunks[3].content).not.toContain("mailto:");
    expect(chunks.map((item) => item.content).join(" ")).not.toContain(
      "próximos 24 meses",
    );
  });

  it("keeps only https URLs beside their link text", () => {
    const [guide] = extractCcssPrescripcionChunks(
      "ccss-prescripcion",
      "CCSS — Prescripción de deudas",
      `<h3>¿Dónde consulto?</h3>
      <p>
        <a href="https://www.ccss.sa.cr/segura">la guía</a>,
        <a href="/oficinas">las oficinas</a>,
        <a href="http://www.ccss.sa.cr/plana">la versión plana</a>,
        <a href="javascript:alert(1)">el enlace</a>,
        <a href="data:text/html;base64,PGI+eDwvYj4=">los datos</a>,
        <a href="mailto:cobros@ccss.sa.cr">cobros@ccss.sa.cr</a>.
      </p>
      <section id="why-us"></section>`,
      PAGE_URL,
      1,
    );
    expect(guide.content.replace(/^\[[^\]]*\]\s*/, "")).toBe(
      "la guía (https://www.ccss.sa.cr/segura), " +
        "las oficinas (https://www.ccss.sa.cr/oficinas), " +
        "la versión plana, el enlace, los datos, cobros@ccss.sa.cr.",
    );
  });

  it("fails before ingestion when the heading floor is missed", () => {
    expect(() =>
      extractCcssPrescripcionChunks(
        "ccss-prescripcion",
        "CCSS — Prescripción de deudas",
        fixture,
        PAGE_URL,
        5,
      ),
    ).toThrow(/found 4 heading chunks; expected at least 5/);
  });
});

describe("fetchCcssPrescripcion", () => {
  it("uses the browser User-Agent required by official CCSS pages", async () => {
    const fake = vi.fn<FetchLike>(async () => new Response("<html>ok</html>"));
    await fetchCcssPrescripcion(PAGE_URL, fake);
    const headers = fake.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("fails loudly when the official page rejects the request", async () => {
    const fake = vi.fn<FetchLike>(
      async () => new Response("Forbidden", { status: 403 }),
    );
    await expect(fetchCcssPrescripcion(PAGE_URL, fake)).rejects.toThrow(
      /HTTP 403.*User-Agent rejected/,
    );
  });
});

describe("headingCountMessage", () => {
  it("reports heading chunks and crawl drift", () => {
    expect(headingCountMessage(25, 24)).toBe(
      "25 heading chunks (change from cached crawl: +1)",
    );
  });
});
