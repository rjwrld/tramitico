import { describe, expect, it, vi } from "vitest";
import { fetchNorma, type FetchLike } from "./sinalevi";

function res(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function ficha(n: number, of: number, id: number) {
  return {
    html: `<div class="k-card">Versión de la Norma: ${n} de ${of}</div>`,
    idVersionNorma: id,
  };
}

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
