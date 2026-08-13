// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Citation } from "@/lib/retrieval";
import { Sello, SelloRow, selloLabel } from "@/components/sello";

afterEach(cleanup);

const reglamentoIva: Citation = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953&param2=&param3=1&param4=",
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

  it("renders nothing when there are no citations", () => {
    const { container } = render(<SelloRow citations={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
