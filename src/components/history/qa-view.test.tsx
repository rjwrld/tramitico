// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { QAView } from "./qa-view";
import type { HistoryItem } from "./history-sidebar";

afterEach(cleanup);

const baseItem: HistoryItem = {
  id: "q-1",
  question: "¿Debo facturar electrónicamente?",
  answer: "Sí, debe emitir factura electrónica.",
  citations: [],
  created_at: "2026-08-01T10:00:00Z",
};

describe("QAView", () => {
  it("renders a sello for a citation in the persisted shape (docKey/docTitle/articulo/norma/url)", () => {
    render(
      <QAView
        item={{
          ...baseItem,
          citations: [
            {
              docKey: "reglamento-iva",
              docTitle:
                "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
              norma: "Decreto Ejecutivo 41779",
              articulo: "Artículo 11",
              url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
            },
          ],
        }}
        onBack={vi.fn()}
      />,
    );

    const chip = screen.getByRole("link", { name: "Reglamento IVA · Art. 11" });
    expect(chip.getAttribute("href")).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
    );
  });

  it("renders the persisted markers as superscripts anchored to the sellos (#133)", () => {
    render(
      <QAView
        item={{
          ...baseItem,
          // Persisted answers already carry the sello numbering — the route
          // renumbers before `saveQuestion` writes.
          answer: "Sí, debe facturar[1]. Y declarar[2].",
          citations: [
            {
              docKey: "reglamento-iva",
              docTitle: "Reglamento IVA",
              norma: null,
              articulo: "Artículo 11",
              url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
            },
            {
              docKey: "ley-9635",
              docTitle: "Ley 9635",
              norma: null,
              articulo: "Artículo 4",
              url: null,
            },
          ],
        }}
        onBack={vi.fn()}
      />,
    );

    const sellos = screen.getAllByRole("listitem");
    expect(sellos.map((li) => li.id)).toEqual(["q-1-fuente-1", "q-1-fuente-2"]);
    for (const [i, name] of ["fuente 1", "fuente 2"].entries()) {
      const href = screen.getByRole("link", { name }).getAttribute("href")!;
      expect(document.getElementById(href.slice(1))).toBe(sellos[i]);
    }
  });

  it("drops a persisted marker no sello backs", () => {
    render(
      <QAView
        item={{
          ...baseItem,
          answer: "Sí, debe facturar[1]. Y algo más[2].",
          citations: [
            {
              docKey: "reglamento-iva",
              docTitle: "Reglamento IVA",
              norma: null,
              articulo: "Artículo 11",
              url: null,
            },
          ],
        }}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: "fuente 2" })).toBeNull();
    expect(document.body.textContent).toContain("Y algo más.");
  });

  it("renders a pre-#133 answer with no markers unchanged", () => {
    render(<QAView item={baseItem} onBack={vi.fn()} />);

    expect(screen.queryByRole("link", { name: /^fuente/ })).toBeNull();
    expect(
      screen.getByText("Sí, debe emitir factura electrónica."),
    ).toBeTruthy();
  });

  it("drops malformed or legacy-shaped citation entries instead of throwing", () => {
    expect(() =>
      render(
        <QAView
          item={{
            ...baseItem,
            citations: [
              // Legacy shape from before ADR 0004 (issue #94).
              { label: "Reglamento IVA · Art. 11" },
              // Garbage that could come back through the Json column.
              "not-an-object",
              null,
              42,
              { docKey: "reglamento-iva" }, // missing required fields
              {
                docKey: "ley-iva",
                docTitle: "Ley del Impuesto sobre el Valor Agregado",
                norma: null,
                articulo: "Artículo 8",
                url: null,
              },
            ],
          }}
          onBack={vi.fn()}
        />,
      ),
    ).not.toThrow();

    // Only the one well-formed entry renders, as a non-link stamp (no url).
    expect(screen.getByText("Ley IVA · Art. 8")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders no sello row when there are no citations", () => {
    render(<QAView item={baseItem} onBack={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Fuentes" })).toBeNull();
  });

  it("calls onBack when the Volver button is clicked", async () => {
    const onBack = vi.fn();
    render(<QAView item={baseItem} onBack={onBack} />);

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
