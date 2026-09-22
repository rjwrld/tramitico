import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCcssFaqChunks,
  faqCountMessage,
  fetchCcssFaq,
  verifyImageTranscriptions,
  type FaqImageTranscription,
} from "./ccss-faq";
import type { Chunk } from "./chunker";
import type { FetchLike } from "./official-http";

const PAGE_URL = "https://www.ccss.sa.cr/preguntas-frecuentes";
const TITLE = "CCSS — Preguntas frecuentes";
const fixture = readFileSync(
  path.resolve(__dirname, "__fixtures__/ccss-faq-modals.html"),
  "utf8",
);

const extract = (
  options: Parameters<typeof extractCcssFaqChunks>[4] = { minimum: 4 },
) => extractCcssFaqChunks("ccss-faq", TITLE, fixture, PAGE_URL, options);

const sha256 = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

describe("extractCcssFaqChunks", () => {
  it("extracts one chunk per relevant question with its category as path", () => {
    const chunks = extract();

    expect(chunks).toHaveLength(4);
    expect(chunks.map(({ articulo, path }) => ({ articulo, path }))).toEqual([
      {
        articulo: "¿Debo asegurarme?",
        path: ["Trabajador Independiente"],
      },
      { articulo: "¿Cómo formalizo un arreglo?", path: ["Cobros"] },
      { articulo: "¿Dónde veo la tabla?", path: ["Seguro voluntario"] },
      { articulo: "¿Cuándo pago?", path: ["Trabajador Independiente"] },
    ]);
    expect(chunks[0].content).toContain(
      "Sí, cuando realiza una actividad generadora de ingresos.",
    );
    expect(chunks[1].content).toContain(
      "requisitos (https://www.ccss.sa.cr/requisitos)",
    );
  });

  it("turns an image-only answer into explicit linked text", () => {
    const chunks = extract();

    expect(chunks[2].content).toContain(
      "respuesta oficial está publicada como imagen",
    );
    expect(chunks[2].content).toContain(
      "https://www.ccss.sa.cr/assets/img/faq/cuotas.png",
    );
    expect(chunks[3].content).toContain(
      "Imagen incluida en la respuesta oficial: https://www.ccss.sa.cr/assets/images/faq/fechas.jpg.",
    );
  });

  it("fails before ingestion when the relevant-question floor is missed", () => {
    expect(() => extract({ minimum: 5 })).toThrow(
      /found 4 relevant FAQ questions; expected at least 5/,
    );
  });

  describe("body duplicates (#301)", () => {
    // The fixture publishes «¿Debo asegurarme?» under both Seguro voluntario
    // and Trabajador Independiente with the same modal text. Only the section
    // inside the bracketed header differs, so whole-chunk equality never sees
    // it, and both copies used to win top-8 slots for one answer.
    it("keeps one chunk per body, preferring the more specific section", () => {
      const chunks = extract();
      const bodies = chunks.map((c) => c.content.replace(/^\[[^\]]*\]\s*/, ""));
      expect(new Set(bodies).size).toBe(bodies.length);
      const kept = chunks.filter((c) => c.articulo === "¿Debo asegurarme?");
      expect(kept).toHaveLength(1);
      expect(kept[0].path).toEqual(["Trabajador Independiente"]);
    });

    it("reports every dropped copy against the chunk that replaced it", () => {
      const onDuplicate = vi.fn<(dropped: Chunk, kept: Chunk) => void>();
      extract({ minimum: 4, onDuplicate });
      expect(onDuplicate).toHaveBeenCalledTimes(1);
      const [dropped, kept] = onDuplicate.mock.calls[0];
      expect(dropped.path).toEqual(["Seguro voluntario"]);
      expect(kept.path).toEqual(["Trabajador Independiente"]);
      expect(dropped.articulo).toBe(kept.articulo);
    });

    it("prefers the longer heading when the sections tie", () => {
      // The live page also publishes one body under two *headings* in the
      // same section («vigencia de la constancia» / «vigencia del documento
      // digital…»); the longer heading names what the answer is about.
      const row = (id: number, heading: string) => `
        <div class="faq-question-text"><strong>${heading}</strong><small>Cobros</small></div>
        <button data-bs-target="#m${id}">Leer</button>
        <div class="modal" id="m${id}"><div class="modal-body">Por el día de la emisión.</div></div>`;
      const html =
        row(1, "¿Cuál es la vigencia?") +
        row(2, "¿Cuál es la vigencia del documento digital de estar al día?");
      const chunks = extractCcssFaqChunks("ccss-faq", TITLE, html, PAGE_URL, {
        minimum: 1,
      });
      expect(chunks.map((c) => c.articulo)).toEqual([
        "¿Cuál es la vigencia del documento digital de estar al día?",
      ]);
    });

    it("counts the floor after deduplication", () => {
      expect(() => extract({ minimum: 5 })).toThrow(/found 4 relevant/);
    });
  });

  describe("image transcriptions (#301)", () => {
    const transcriptions: FaqImageTranscription[] = [
      {
        src: "https://www.ccss.sa.cr/assets/img/faq/cuotas.png",
        sha256: sha256("cuotas"),
        text: "Categoría 1: 2.89%.",
      },
      {
        src: "https://www.ccss.sa.cr/assets/images/faq/fechas.jpg",
        sha256: sha256("fechas"),
        text: "Entre A y C, el día 05.",
      },
    ];

    it("replaces the image notice with the transcribed text", () => {
      const chunks = extract({ minimum: 4, transcriptions });

      expect(chunks[2].content).toBe(
        `[${TITLE} — Seguro voluntario — ¿Dónde veo la tabla?] ` +
          "Transcripción de la imagen que constituye la respuesta oficial " +
          "(https://www.ccss.sa.cr/assets/img/faq/cuotas.png): Categoría 1: 2.89%.",
      );
      expect(chunks[3].content).toBe(
        `[${TITLE} — Trabajador Independiente — ¿Cuándo pago?] ` +
          "Según la primera letra de su apellido: " +
          "Transcripción de la imagen incluida en la respuesta oficial " +
          "(https://www.ccss.sa.cr/assets/images/faq/fechas.jpg): Entre A y C, el día 05.",
      );
      expect(
        chunks.some((c) => c.content.includes("publicada como imagen")),
      ).toBe(false);
    });

    it("leaves an image without a transcription on the notice path", () => {
      const chunks = extract({
        minimum: 4,
        transcriptions: transcriptions.slice(0, 1),
      });
      expect(chunks[3].content).toContain(
        "Imagen incluida en la respuesta oficial: https://www.ccss.sa.cr/assets/images/faq/fechas.jpg.",
      );
    });

    it("fails loudly when a transcribed image is no longer in the crawl", () => {
      // A re-crawl that renames av_tv_2026.png to av_tv_2027.png has replaced
      // the answer; carrying last year's transcription forward would be wrong.
      expect(() =>
        extract({
          minimum: 4,
          transcriptions: [
            ...transcriptions,
            {
              src: "https://www.ccss.sa.cr/assets/img/faq/av_tv_2027.png",
              sha256: sha256("x"),
              text: "…",
            },
          ],
        }),
      ).toThrow(
        /transcription for https:\/\/www\.ccss\.sa\.cr\/assets\/img\/faq\/av_tv_2027\.png matches no image/,
      );
    });
  });
});

describe("verifyImageTranscriptions", () => {
  const bytes = "cuotas-bytes";
  const transcription: FaqImageTranscription = {
    src: "https://www.ccss.sa.cr/assets/img/faq/cuotas.png",
    sha256: sha256(bytes),
    text: "Categoría 1: 2.89%.",
  };

  it("fetches each image with the browser User-Agent and accepts a matching hash", async () => {
    const fake = vi.fn<FetchLike>(async () => new Response(bytes));
    const receipts = await verifyImageTranscriptions(
      "ccss-faq",
      [transcription],
      fake,
    );
    expect(fake).toHaveBeenCalledWith(transcription.src, {
      headers: { "User-Agent": expect.stringMatching(/Mozilla/) },
    });
    expect(receipts).toEqual([
      `ccss-faq: image ${transcription.src} SHA-256 matches its transcription`,
    ]);
  });

  it("fetches from fetchFrom when the page's src is dead, keyed by the src", async () => {
    // The live page links assets/images/faq/fechas_aseg_vol.jpg, which 404s;
    // the same bytes serve from assets/img/faq/. The chunk keeps the page's
    // URL; the hash check goes where the bytes are.
    const fake = vi.fn<FetchLike>(async () => new Response(bytes));
    await verifyImageTranscriptions(
      "ccss-faq",
      [{ ...transcription, fetchFrom: "https://www.ccss.sa.cr/mirror.png" }],
      fake,
    );
    expect(fake.mock.calls[0][0]).toBe("https://www.ccss.sa.cr/mirror.png");
  });

  it("fails when the bytes no longer match the transcribed image", async () => {
    const fake = vi.fn<FetchLike>(async () => new Response("new-bytes"));
    await expect(
      verifyImageTranscriptions("ccss-faq", [transcription], fake),
    ).rejects.toThrow(
      /cuotas\.png changed since it was transcribed — manifest [a-f0-9]{64}, fetched [a-f0-9]{64}/,
    );
  });

  it("fails when the image cannot be fetched", async () => {
    const fake = vi.fn<FetchLike>(
      async () => new Response("gone", { status: 404 }),
    );
    await expect(
      verifyImageTranscriptions("ccss-faq", [transcription], fake),
    ).rejects.toThrow(/cuotas\.png: HTTP 404/);
  });

  it("rejects a malformed manifest hash before fetching anything", async () => {
    const fake = vi.fn<FetchLike>();
    await expect(
      verifyImageTranscriptions(
        "ccss-faq",
        [{ ...transcription, sha256: "TBD" }],
        fake,
      ),
    ).rejects.toThrow(
      /sha256 for .*cuotas\.png must be 64 lowercase hex digits/,
    );
    expect(fake).not.toHaveBeenCalled();
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
