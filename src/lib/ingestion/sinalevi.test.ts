import { describe, expect, it, vi } from "vitest";
import type { Chunk } from "./chunker";
import {
  articuloAnchors,
  fetchNorma,
  filterArticulos,
  type FetchLike,
} from "./sinalevi";

function res(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function ficha(n: number, of: number, id: number) {
  return {
    html: `<div class="k-card">Versión de la Norma: ${n} de ${of}</div>`,
    idVersionNorma: id,
  };
}

/**
 * The "Ficha Artículo" rail SINALEVI appends to the full text: one anchor per
 * artículo, carrying `(numeroArticulo, idFichaNorma, idVersionNorma,
 * idArticulo)`. Ficha 99349 shows the trap encoded below — a norma's
 * transitorios reuse the artículo numbers, so number 2 resolves to two ids.
 */
const FICHA_LINKS = `
<p>texto</p>
<div class="pb-5 pt-2"><a class="enlaceFicha" href="javascript:void(0);" aria-label="Abrir artículo número 1 " onclick="handleArticuloClick(1, 98767, 147960, 2)">Ficha Artículo 1</a></div>
<div class="pb-5 pt-2"><a class="enlaceFicha" href="javascript:void(0);" aria-label="Abrir artículo número 2 " onclick="handleArticuloClick(2, 98767, 147960, 3)">Ficha Artículo 2</a></div>
<div class="pb-5 pt-2"><a class="enlaceFicha" href="javascript:void(0);" aria-label="Abrir artículo número 3 " onclick="handleArticuloClick(3, 98767, 147960, 4)">Ficha Artículo 3</a></div>
<div class="pb-5 pt-2"><a class="enlaceFicha" href="javascript:void(0);" aria-label="Abrir artículo número 2 " onclick="handleArticuloClick(2, 98767, 147960, 5)">Ficha Artículo 2</a></div>
`;

describe("articuloAnchors", () => {
  it("maps each artículo number to its viewer id", () => {
    expect(articuloAnchors(FICHA_LINKS)).toEqual({ "1": 2, "3": 4 });
  });

  it("drops numbers claimed by more than one artículo", () => {
    // Number 2 is both Artículo 2 and its transitorio — an anchor built from
    // it would land on whichever the harvest saw last, so it gets none.
    expect(articuloAnchors(FICHA_LINKS)["2"]).toBeUndefined();
  });

  it("is empty for a text with no artículo rail", () => {
    expect(articuloAnchors("<p>documento sin artículos</p>")).toEqual({});
    expect(articuloAnchors("handleArticuloClick(0, 1, 2, 3)")).toEqual({});
  });
});

describe("fetchNorma", () => {
  it("resolves the vigente version, never the redirect default", async () => {
    const bodies: string[] = [];
    const fake: FetchLike = async (url, init) => {
      if (url.includes("_BuscarVersionNorma")) {
        const body = String(init?.body);
        bodies.push(body);
        return body.endsWith("numeroVersion=1")
          ? res(ficha(1, 16, 116520))
          : res(ficha(16, 16, 148633));
      }
      return res({ html: "<div>texto vigente</div>" });
    };

    const norma = await fetchNorma(88953, fake);

    expect(norma.cantidadVersiones).toBe(16);
    expect(norma.idVersionNorma).toBe(148633);
    expect(norma.html).toContain("texto vigente");
    expect(bodies).toEqual([
      "idFichaNorma=88953&numeroVersion=1",
      "idFichaNorma=88953&numeroVersion=16",
    ]);
  });

  it("skips the second lookup for single-version normas", async () => {
    const fake = vi.fn<FetchLike>(async (url) => {
      if (url.includes("_BuscarVersionNorma")) return res(ficha(1, 1, 135825));
      return res({ html: "<p>texto</p>" });
    });

    const norma = await fetchNorma(99349, fake);

    expect(norma.idVersionNorma).toBe(135825);
    expect(
      fake.mock.calls.filter(([u]) => u.includes("_BuscarVersionNorma")),
    ).toHaveLength(1);
  });

  it("sends a browser User-Agent on every call", async () => {
    const fake = vi.fn<FetchLike>(async (url) => {
      if (url.includes("_BuscarVersionNorma")) return res(ficha(1, 1, 7));
      return res({ html: "<p>x</p>" });
    });

    await fetchNorma(99349, fake);

    for (const call of fake.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers["User-Agent"]).toMatch(/Mozilla/);
    }
  });

  it("harvests the per-artículo anchor ids the viewer deep-links by (#134)", async () => {
    const fake: FetchLike = async (url) => {
      if (url.includes("_BuscarVersionNorma")) return res(ficha(1, 1, 147960));
      return res({ html: FICHA_LINKS });
    };

    const norma = await fetchNorma(98767, fake);

    expect(articuloAnchors(norma.html)).toEqual({ "1": 2, "3": 4 });
  });

  it("fails loudly on an unknown idFichaNorma", async () => {
    const fake: FetchLike = async () =>
      res({ html: "<div></div>", idVersionNorma: 0 });
    await expect(fetchNorma(1, fake)).rejects.toThrow(/bad idFichaNorma/);
  });

  it("fails loudly when the ficha shape changes", async () => {
    const fake: FetchLike = async () =>
      res({ html: "<div>sin numeración</div>", idVersionNorma: 5 });
    await expect(fetchNorma(1, fake)).rejects.toThrow(/page shape changed/);
  });

  it("fails loudly on HTTP errors instead of retrying blind", async () => {
    const fake: FetchLike = async () =>
      new Response("forbidden", { status: 403 });
    await expect(fetchNorma(1, fake)).rejects.toThrow(/HTTP 403/);
  });
});

describe("filterArticulos", () => {
  const chunk = (articulo: string | null, path: string[], part = 0): Chunk => ({
    docKey: "cnpt",
    articulo,
    path,
    part,
    content: `${articulo ?? "sin artículo"} texto`,
  });

  const TITULO_II = [
    "TITULO II OBLIGACION TRIBUTARIA",
    "CAPITULO VI Intereses",
  ];
  const TITULO_III = [
    "TÍTULO III HECHOS ILÍCITOS TRIBUTARIOS",
    "SECCIÓN II INFRACCIONES ADMINISTRATIVAS",
  ];

  // The shape of ficha 6530: the claimed artículos sit in two títulos with
  // unclaimed ones between and around them, art. 81 runs long enough to be
  // sub-split, and a preámbulo chunk carries no artículo at all.
  const CODIGO: Chunk[] = [
    chunk(null, TITULO_II),
    chunk("Artículo 56", TITULO_II),
    chunk("Artículo 57", TITULO_II),
    chunk("Artículo 58", TITULO_II),
    chunk("Artículo 77", TITULO_III),
    chunk("Artículo 78", TITULO_III),
    chunk("Artículo 80 bis", TITULO_III),
    chunk("Artículo 81", TITULO_III),
    chunk("Artículo 81", TITULO_III, 1),
    chunk("Artículo 82", TITULO_III),
    chunk("Artículo 88", TITULO_III),
  ];

  it("keeps exactly the listed artículos, in document order", () => {
    const kept = filterArticulos("cnpt", CODIGO, [
      "Artículo 78",
      "Artículo 88",
      "Artículo 57",
      "Artículo 80 bis",
      "Artículo 81",
    ]);

    expect(kept.map((c) => `${c.articulo}#${c.part}`)).toEqual([
      "Artículo 57#0",
      "Artículo 78#0",
      "Artículo 80 bis#0",
      "Artículo 81#0",
      "Artículo 81#1",
      "Artículo 88#0",
    ]);
  });

  it("keeps each chunk's own path, so a citation still names its título", () => {
    const kept = filterArticulos("cnpt", CODIGO, [
      "Artículo 57",
      "Artículo 78",
    ]);

    expect(kept.map((c) => c.path[0])).toEqual([
      "TITULO II OBLIGACION TRIBUTARIA",
      "TÍTULO III HECHOS ILÍCITOS TRIBUTARIOS",
    ]);
  });

  it("matches labels whatever casing and spacing the ficha uses", () => {
    const kept = filterArticulos("cnpt", CODIGO, ["ARTÍCULO 80  BIS"]);

    expect(kept.map((c) => c.articulo)).toEqual(["Artículo 80 bis"]);
  });

  it("fails loudly when a claimed artículo is no longer there", () => {
    expect(() => filterArticulos("cnpt", CODIGO, ["Artículo 79"])).toThrow(
      /"Artículo 79", which no chunk carries/,
    );
  });

  it("fails loudly when the same artículo is listed twice", () => {
    expect(() =>
      filterArticulos("cnpt", CODIGO, ["Artículo 78", "ARTÍCULO 78"]),
    ).toThrow(/lists "ARTÍCULO 78" twice/);
  });

  it("fails loudly when the número repeats across títulos", () => {
    const ambiguous = [
      ...CODIGO,
      chunk("Artículo 57", ["TITULO IX", "CAPÍTULO I"]),
    ];

    expect(() => filterArticulos("cnpt", ambiguous, ["Artículo 57"])).toThrow(
      /2 different títulos carry/,
    );
  });
});
