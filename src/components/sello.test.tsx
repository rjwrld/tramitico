// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  toCitation,
  type Citation,
  type RetrievedChunk,
} from "@/lib/retrieval";
import {
  SHORT_NAME_TOKENS,
  Sello,
  SelloRow,
  docShortName,
  fetchedLabel,
  selloLabel,
} from "@/components/sello";
/** The corpus manifest — the set of doc_keys a sello can ever have to print. */
import MANIFEST from "../../corpus/manifest.json";

afterEach(cleanup);

/** Retrieval's own chunk shape — the citation the UI renders comes from it. */
const CHUNK: RetrievedChunk = {
  chunkId: "11111111-1111-1111-1111-111111111111",
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  path: [],
  part: 1,
  content: "…",
  source: {},
  score: 0.1,
  vectorRank: 1,
  lexicalRank: 1,
  fetchedAt: "2026-08-06T15:04:05Z",
};

const reglamentoIva: Citation = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953&param2=&param3=1&param4=",
  fetchedAt: "2026-08-06T15:04:05Z",
};

describe("selloLabel", () => {
  it("shortens doc key and artículo into the stamp text", () => {
    expect(selloLabel(reglamentoIva)).toBe("Reglamento IVA · Art. 11");
  });

  it("uppercases acronyms and roman numerals from the doc key", () => {
    expect(
      selloLabel({
        ...reglamentoIva,
        docKey: "reglamento-titulo-iv-9635",
        articulo: "Artículo 3 bis",
      }),
    ).toBe("Reglamento Título IV 9635 · Art. 3 bis");
    expect(
      selloLabel({ ...reglamentoIva, docKey: "ccss-bmc", articulo: null }),
    ).toBe("CCSS BMC");
  });

  // ADR 0004 consequence: every manifest doc_key needs a correct stamp label.
  // `reglamento-rts` arrived with the RTS normative source (issue #108).
  it("labels the RTS reglamento doc key", () => {
    expect(
      selloLabel({
        ...reglamentoIva,
        docKey: "reglamento-rts",
        articulo: "Artículo 1",
      }),
    ).toBe("Reglamento RTS · Art. 1");
  });

  // The two artículo-scoped companions to `reglamento-iva` (issue #176): each
  // carries one formula the SINALEVI ficha renders as an image.
  it("labels the artículo-scoped reglamento IVA doc keys", () => {
    expect(
      selloLabel({
        ...reglamentoIva,
        docKey: "reglamento-iva-bienes-capital",
        articulo: "Artículo 31",
      }),
    ).toBe("Reglamento IVA Bienes Capital · Art. 31");
    expect(
      selloLabel({
        ...reglamentoIva,
        docKey: "reglamento-iva-retencion-tarjetas",
        articulo: "Artículo 41",
      }),
    ).toBe("Reglamento IVA Retención Tarjetas · Art. 41");
  });

  // The chunker's own ART_RE emits all-caps `ARTÍCULO N` headings, which the
  // case-sensitive abbreviation used to leave unabbreviated (#214);
  // `articuloAnchorKey` in retrieval.ts matches case-insensitively for the
  // same reason.
  it("abbreviates the artículo whatever casing the heading carried", () => {
    expect(selloLabel({ ...reglamentoIva, articulo: "ARTÍCULO 3" })).toBe(
      "Reglamento IVA · Art. 3",
    );
    expect(selloLabel({ ...reglamentoIva, articulo: "artículo 3 bis" })).toBe(
      "Reglamento IVA · Art. 3 bis",
    );
    // Unaccented headings occur in the wild too.
    expect(selloLabel({ ...reglamentoIva, articulo: "ARTICULO 11" })).toBe(
      "Reglamento IVA · Art. 11",
    );
  });

  it("keeps transitorios and preámbulo unabbreviated", () => {
    expect(selloLabel({ ...reglamentoIva, articulo: "Transitorio II" })).toBe(
      "Reglamento IVA · Transitorio II",
    );
    expect(selloLabel({ ...reglamentoIva, articulo: "Preámbulo" })).toBe(
      "Reglamento IVA · Preámbulo",
    );
  });
});

/**
 * ADR-0004's invariant, made checkable (#214): the stamp's short name is
 * derived token by token, so a doc_key carrying a token the table does not
 * know silently renders a mis-cased or unaccented word — `ccss-escala-ivm`
 * printed "Ivm" until this test existed. Adding a document to the manifest
 * therefore means deciding how its tokens print, here.
 */
describe("docShortName covers the manifest", () => {
  const docKeys = MANIFEST.documents.map((d) => d.doc_key);

  it("knows every token of every manifest doc_key", () => {
    const unknown = docKeys
      .flatMap((key) => key.split("-").filter(Boolean))
      .filter((token) => !Object.hasOwn(SHORT_NAME_TOKENS, token));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("does not mistake an Object.prototype member for a known token", () => {
    expect(docShortName("constructor-toString")).toBe("Constructor ToString");
  });

  it("prints each manifest doc_key the way its title spells it", () => {
    expect(
      Object.fromEntries(docKeys.map((k) => [k, docShortName(k)])),
    ).toEqual({
      "ley-iva": "Ley IVA",
      "reglamento-iva": "Reglamento IVA",
      "reglamento-iva-bienes-capital": "Reglamento IVA Bienes Capital",
      "reglamento-iva-retencion-tarjetas": "Reglamento IVA Retención Tarjetas",
      "ley-9635": "Ley 9635",
      "reglamento-titulo-iv-9635": "Reglamento Título IV 9635",
      "reglamento-renta": "Reglamento Renta",
      "tramos-renta-2026": "Tramos Renta 2026",
      "ley-10363": "Ley 10363",
      "ccss-bmc": "CCSS BMC",
      "ccss-escala-ivm": "CCSS Escala IVM",
      "ccss-escala-salud": "CCSS Escala Salud",
      "salarios-minimos": "Salarios Mínimos",
      "reglamento-rts": "Reglamento RTS",
      "reglamento-comprobantes": "Reglamento Comprobantes",
      "disposiciones-v44": "Disposiciones v4.4",
      "dgt-export-servicios": "DGT Export Servicios",
      "tribu-cr-guia": "TRIBU CR Guía",
      "cabys-dev": "CABYS Dev",
    });
  });
});

describe("fetchedLabel", () => {
  it("prints the fetch date as a quiet Spanish caption", () => {
    expect(fetchedLabel("2026-08-06T15:04:05Z")).toBe(
      "consultado el 6 ago 2026",
    );
  });

  it("reads the timestamp on the Costa Rica calendar, not the runner's", () => {
    // 03:30 UTC on the 7th is still 21:30 on the 6th in Costa Rica (UTC-6,
    // no DST — the same fixed shift #125 uses for the daily quota).
    expect(fetchedLabel("2026-08-07T03:30:00Z")).toBe(
      "consultado el 6 ago 2026",
    );
    expect(fetchedLabel("2026-08-07T06:00:00Z")).toBe(
      "consultado el 7 ago 2026",
    );
  });

  it("spells September the way Costa Rica does", () => {
    expect(fetchedLabel("2026-09-15T12:00:00Z")).toBe(
      "consultado el 15 set 2026",
    );
  });

  it("has nothing to say about a document with no fetch date", () => {
    expect(fetchedLabel(null)).toBeNull();
    expect(fetchedLabel(undefined)).toBeNull();
    expect(fetchedLabel("no es una fecha")).toBeNull();
  });
});

describe("Sello", () => {
  it("is itself the link to the official source at the cited artículo", () => {
    render(<Sello citation={reglamentoIva} />);
    const chip = screen.getByRole("link", {
      name: "Reglamento IVA · Art. 11",
    });
    expect(chip.getAttribute("href")).toBe(reglamentoIva.url);
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(chip.getAttribute("rel")).toContain("noopener");
  });

  // #134: the chip must carry the artículo-level address the retrieval layer
  // derives, not just the document root — built here the way the answer path
  // builds it, from an anchored source.
  it("opens the artículo view for a deep-linkable source (#134)", () => {
    const citation = toCitation({
      ...CHUNK,
      docKey: "reglamento-iva",
      docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
      norma: "Decreto Ejecutivo 41779",
      articulo: "Artículo 11",
      source: {
        kind: "sinalevi",
        idFichaNorma: 88953,
        idVersionNorma: 148633,
        deepLink: "articulo",
        articulos: { "11": 12 },
      },
    });

    render(<Sello citation={citation} />);

    expect(
      screen
        .getByRole("link", { name: "Reglamento IVA · Art. 11" })
        .getAttribute("href"),
    ).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953&param2=148633&param3=3&param4=12&param5=",
    );
  });

  it("renders a plain stamp when the citation has no official URL", () => {
    render(<Sello citation={{ ...reglamentoIva, url: null }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Reglamento IVA · Art. 11")).toBeTruthy();
  });

  it("stamp-settles in, and not at all under reduced motion", () => {
    render(<Sello citation={reglamentoIva} />);
    const chip = screen.getByRole("link", {
      name: "Reglamento IVA · Art. 11",
    });
    expect(chip.className).toContain("animate-stamp-settle");
    expect(chip.className).toContain("motion-reduce:animate-none");
  });
});

describe("SelloRow", () => {
  it("renders one sello per citation under a Fuentes label", () => {
    render(
      <SelloRow
        citations={[
          reglamentoIva,
          { ...reglamentoIva, docKey: "ley-iva", articulo: "Artículo 8" },
        ]}
      />,
    );
    const row = screen.getByRole("list", { name: "Fuentes" });
    expect(row.querySelectorAll("[data-slot=sello]")).toHaveLength(2);
  });

  it("anchors each sello for the prose's superscripts (#133)", () => {
    render(
      <SelloRow
        anchorPrefix="«r3»"
        citations={[
          reglamentoIva,
          { ...reglamentoIva, docKey: "ley-iva", articulo: "Artículo 8" },
        ]}
      />,
    );

    // useId spells its ids with punctuation an href fragment cannot carry.
    expect(screen.getAllByRole("listitem").map((li) => li.id)).toEqual([
      "r3-fuente-1",
      "r3-fuente-2",
    ]);
    // The stamp itself is untouched (DESIGN §5) — no number on the chip.
    expect(
      screen.getByRole("link", { name: "Reglamento IVA · Art. 11" })
        .textContent,
    ).toBe("Reglamento IVA · Art. 11");
  });

  it("leaves the sellos unanchored when no answer owns them", () => {
    render(<SelloRow citations={[reglamentoIva]} />);
    expect(screen.getByRole("listitem").id).toBe("");
  });

  it("captions every stamp with the date its source was consulted (#135)", () => {
    render(
      <SelloRow
        citations={[
          reglamentoIva,
          {
            ...reglamentoIva,
            docKey: "ley-iva",
            articulo: "Artículo 8",
            fetchedAt: "2026-08-04T09:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      [
        "Reglamento IVA · Art. 11consultado el 6 ago 2026",
        "Ley IVA · Art. 8consultado el 4 ago 2026",
      ],
    );
  });

  it("leaves a source with no fetch date uncaptioned rather than guessing", () => {
    // Rows persisted before #135 carry no fetchedAt at all; a chip with no
    // date prints no date — nothing is invented to fill the slot.
    const legacy: Citation = { ...reglamentoIva };
    delete legacy.fetchedAt;
    render(<SelloRow citations={[legacy]} />);
    expect(screen.getByRole("listitem").textContent).toBe(
      "Reglamento IVA · Art. 11",
    );
  });

  it("renders nothing when there are no citations", () => {
    const { container } = render(<SelloRow citations={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
