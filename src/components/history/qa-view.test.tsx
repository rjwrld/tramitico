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
