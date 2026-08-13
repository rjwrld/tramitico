// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Citation } from "@/lib/retrieval";
import { Sello, SelloRow, fetchedLabel, selloLabel } from "@/components/sello";

afterEach(cleanup);

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

  it("keeps transitorios and preámbulo unabbreviated", () => {
    expect(selloLabel({ ...reglamentoIva, articulo: "Transitorio II" })).toBe(
      "Reglamento IVA · Transitorio II",
    );
    expect(selloLabel({ ...reglamentoIva, articulo: "Preámbulo" })).toBe(
      "Reglamento IVA · Preámbulo",
    );
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
