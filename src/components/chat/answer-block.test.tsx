// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnswerBlock, DISCLAIMER } from "@/components/chat/answer-block";
import {
  CITATIONS_PART_ID,
  MARKERS_PART_ID,
  STATUS_PART_ID,
  type AskUIMessage,
} from "@/lib/answer/contract";
import type { Citation } from "@/lib/retrieval";

afterEach(cleanup);

const citation: Citation = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
};

const otherCitation: Citation = {
  docKey: "ley-9635",
  docTitle: "Ley 9635",
  norma: "Ley 9635",
  articulo: "Artículo 4",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=1",
};

function answer(
  text: string,
  citations: Citation[] = [citation],
  ordinals?: number[],
): AskUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text },
      { type: "data-citations", id: CITATIONS_PART_ID, data: citations },
      ...(ordinals
        ? ([
            { type: "data-markers", id: MARKERS_PART_ID, data: ordinals },
          ] as const)
        : []),
    ],
  };
}

describe("AnswerBlock", () => {
  it("captions each streamed source with the date it was consulted (#135)", () => {
    render(
      <AnswerBlock
        message={answer("La tarifa es 13% [1].", [
          { ...citation, fetchedAt: "2026-08-06T15:04:05Z" },
        ])}
      />,
    );
    expect(screen.getByRole("listitem").textContent).toBe(
      "Reglamento IVA · Art. 11consultado el 6 ago 2026",
    );
  });

  it("drops [n] markers the streamed map cannot resolve (#75)", () => {
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

  describe("inline references (#133)", () => {
    // Chunks 6 and 8 are two slices of the same artículo — one sello, so one
    // superscript number; chunk 1 is the second sello.
    const ORDINALS = [2, 0, 0, 0, 0, 1, 0, 1];
    const message = answer(
      "Están exentos del pago del impuesto [6][8]. La tarifa es 13% [1].",
      [citation, otherCitation],
      ORDINALS,
    );

    it("numbers each claim by the sello it rests on", () => {
      render(<AnswerBlock message={message} />);

      const prose = document.querySelector('[data-slot="answer"] > div');
      expect(prose?.textContent).toBe(
        "Están exentos del pago del impuesto1. La tarifa es 13%2.",
      );
      expect(
        screen
          .getAllByRole("link", { name: /^fuente/ })
          .map((l) => l.textContent),
      ).toEqual(["1", "2"]);
    });

    it("anchors each superscript to its sello", () => {
      render(<AnswerBlock message={message} />);

      const sellos = screen.getAllByRole("listitem");
      expect(sellos.map((li) => li.id)).toEqual(["a1-fuente-1", "a1-fuente-2"]);

      for (const [i, name] of ["fuente 1", "fuente 2"].entries()) {
        const link = screen.getByRole("link", { name });
        const href = link.getAttribute("href")!;
        expect(href).toBe(`#${sellos[i].id}`);
        // The fragment resolves to the sello, not merely to some element.
        const target = document.getElementById(href.slice(1));
        expect(target).toBe(sellos[i]);
        expect(target!.querySelector('[data-slot="sello"]')).toBeTruthy();
      }
    });

    it("takes the reader to the sello when a superscript is clicked", () => {
      render(<AnswerBlock message={message} />);

      const link = screen.getByRole("link", { name: "fuente 2" });
      const clicked = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      fireEvent(link, clicked);

      // jsdom does not run the fragment navigation itself, so the assertion
      // is on the two halves that make it happen in a browser: nothing in
      // our tree cancels the click, and the fragment it would follow
      // resolves to the sello — which is what the browser scrolls to.
      expect(clicked.defaultPrevented).toBe(false);
      const landed = document.getElementById(
        link.getAttribute("href")!.slice(1),
      )!;
      expect(landed).toBe(screen.getAllByRole("listitem")[1]);
      expect(landed.textContent).toBe("Ley 9635 · Art. 4");
    });

    it("leaves the sello itself untouched", () => {
      render(<AnswerBlock message={message} />);

      expect(
        screen.getByRole("link", { name: "Reglamento IVA · Art. 11" }),
      ).toHaveProperty(
        "href",
        "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953",
      );
    });

    it("hides a marker still being typed while the answer streams", () => {
      render(
        <AnswerBlock
          message={answer(
            "La tarifa es 13% [1",
            [citation, otherCitation],
            ORDINALS,
          )}
          busy
        />,
      );

      const prose = document.querySelector('[data-slot="answer"] > div');
      expect(prose?.textContent).toBe("La tarifa es 13%");
    });
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

/** No `@testing-library/jest-dom` in this repo — plain DOM reads instead. */
function ariaBusy(): string | null {
  return (
    document.querySelector('[data-slot="answer"]')?.getAttribute("aria-busy") ??
    null
  );
}

describe("AnswerBlock staged status (#72)", () => {
  function statusMessage(stage: "buscando" | "redactando"): AskUIMessage {
    return {
      id: "a1",
      role: "assistant",
      parts: [{ type: "data-status", id: STATUS_PART_ID, data: { stage } }],
    };
  }

  it("is not aria-busy by default", () => {
    render(<AnswerBlock message={answer("La tarifa es 13% [1].")} />);
    expect(ariaBusy()).toBe("false");
  });

  it("marks the container aria-busy while busy, and shows the stage label when there is no prose yet", () => {
    render(<AnswerBlock message={statusMessage("buscando")} busy />);
    expect(ariaBusy()).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      "Consultando los documentos oficiales…",
    );
  });

  it("hides the stage label once prose exists, even while still busy (req 4)", () => {
    const message: AskUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "data-status",
          id: STATUS_PART_ID,
          data: { stage: "redactando" },
        },
        { type: "text", text: "Con el formulario" },
      ],
    };
    render(<AnswerBlock message={message} busy />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(ariaBusy()).toBe("true");
  });

  it("ignores a stage snapshot once the message is no longer the busy one", () => {
    render(<AnswerBlock message={statusMessage("buscando")} busy={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the completion summary when passed, independent of busy", () => {
    render(
      <AnswerBlock
        message={answer("La tarifa es 13% [1].")}
        completionText="Respuesta lista, 1 fuente citada."
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Respuesta lista, 1 fuente citada.",
    );
  });
});
