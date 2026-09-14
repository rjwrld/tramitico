import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  doc_key: string;
  title: string;
  norma: string | null;
  source: unknown;
  effective_date: string | null;
  fetched_at: string | null;
};

let client: unknown = null;
let rows: Row[] = [];
let failure: { message: string } | null = null;
let throwOnRead = false;

vi.mock("@/lib/supabase/service", () => ({
  tryServiceClient: () => client,
}));

const fakeClient = {
  from: (table: string) => {
    expect(table).toBe("documents");
    return {
      select: () => ({
        order: async () => {
          if (throwOnRead) throw new Error("boom");
          return { data: failure ? null : rows, error: failure };
        },
      }),
    };
  },
};

describe("loadCorpusSources", () => {
  beforeEach(() => {
    client = fakeClient;
    rows = [];
    failure = null;
    throwOnRead = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns nothing when the service client is not configured", async () => {
    client = null;
    const { loadCorpusSources } = await import("./corpus-sources");
    expect(await loadCorpusSources()).toEqual([]);
  });

  it("shapes each row as a citation with the official URL and both dates", async () => {
    rows = [
      {
        doc_key: "reglamento-iva",
        title: "Reglamento de la Ley del IVA",
        norma: "Decreto 41779-H",
        source: { kind: "sinalevi", idFichaNorma: 89012, deepLink: "articulo" },
        effective_date: "2019-07-01",
        fetched_at: "2026-09-04T17:02:10.282Z",
      },
      {
        doc_key: "tramos-renta-2026",
        title: "Tramos de renta 2026",
        norma: null,
        source: { kind: "html", url: "https://www.hacienda.go.cr/tramos" },
        effective_date: null,
        fetched_at: null,
      },
    ];
    const { loadCorpusSources } = await import("./corpus-sources");
    const sources = await loadCorpusSources();
    expect(sources).toEqual([
      {
        docKey: "reglamento-iva",
        docTitle: "Reglamento de la Ley del IVA",
        norma: "Decreto 41779-H",
        articulo: null,
        url: expect.stringContaining("param1=89012"),
        effectiveAt: "2019-07-01",
        fetchedAt: "2026-09-04T17:02:10.282Z",
      },
      {
        docKey: "tramos-renta-2026",
        docTitle: "Tramos de renta 2026",
        norma: null,
        articulo: null,
        url: "https://www.hacienda.go.cr/tramos",
        effectiveAt: null,
        fetchedAt: null,
      },
    ]);
  });

  it("degrades to an empty list on a query error, logging without content", async () => {
    failure = { message: "permission denied" };
    const { loadCorpusSources } = await import("./corpus-sources");
    expect(await loadCorpusSources()).toEqual([]);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("degrades to an empty list when the client throws", async () => {
    throwOnRead = true;
    const { loadCorpusSources } = await import("./corpus-sources");
    expect(await loadCorpusSources()).toEqual([]);
    expect(console.error).toHaveBeenCalledOnce();
  });
});
