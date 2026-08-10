// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnswerBlock, DISCLAIMER } from "@/components/chat/answer-block";
import { CITATIONS_PART_ID, type AskUIMessage } from "@/lib/answer/contract";
import type { Citation } from "@/lib/retrieval";

afterEach(cleanup);

const citation: Citation = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
};

function answer(
  text: string,
  citations: Citation[] = [citation],
): AskUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text },
      { type: "data-citations", id: CITATIONS_PART_ID, data: citations },
    ],
  };
}

describe("AnswerBlock", () => {
  it("renders the prose without [n] markers, sellos unchanged (#75)", () => {
    render(
      <AnswerBlock
        message={answer(
          "Están exentos del pago del impuesto [6][8]. La tarifa es 13% [1].",
        )}
      />,
    );
    const prose = document.querySelector('[data-slot="answer"] > div');
    expect(prose?.textContent).toBe(
      "Están exentos del pago del impuesto. La tarifa es 13%.",
    );
    expect(screen.getByRole("link")).toHaveProperty(
      "href",
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
    );
  });

  it("shows the disclaimer once there is prose", () => {
    render(<AnswerBlock message={answer("La tarifa es 13% [1].")} />);
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it("hides the disclaimer when the answer is still empty", () => {
    render(<AnswerBlock message={answer("", [])} />);
    expect(screen.queryByText(DISCLAIMER)).toBeNull();
  });
});
