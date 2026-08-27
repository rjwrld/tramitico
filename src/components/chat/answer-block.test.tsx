// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AnswerBlock, DISCLAIMER } from "@/components/chat/answer-block";
import {
  CITATIONS_PART_ID,
  DEGRADED_PART_ID,
  DEGRADED_SEARCH_NOTE,
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

describe("AnswerBlock degraded-search label (#127)", () => {
  /** The same answer, plus the route's `data-degraded` part. */
  function degraded(text: string): AskUIMessage {
    const base = answer(text);
    return {
      ...base,
      parts: [
        { type: "data-degraded", id: DEGRADED_PART_ID, data: true },
        ...base.parts,
      ],
    };
  }

  it("tells the reader the search was lexical-only", () => {
    render(<AnswerBlock message={degraded("La tarifa es 13% [1].")} />);
    expect(screen.getByText(DEGRADED_SEARCH_NOTE)).not.toBeNull();
  });

  it("keeps the answer and its disclaimer — the label qualifies, it does not replace", () => {
    render(<AnswerBlock message={degraded("La tarifa es 13% [1].")} />);
    expect(screen.getByText(/La tarifa es 13%/)).not.toBeNull();
    expect(screen.getByText(DISCLAIMER)).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("sits above the disclaimer, out of the answer's way", () => {
    render(<AnswerBlock message={degraded("La tarifa es 13% [1].")} />);
    const note = screen.getByText(DEGRADED_SEARCH_NOTE);
    const disclaimer = screen.getByText(DISCLAIMER);
    expect(
      note.compareDocumentPosition(disclaimer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing on an ordinary answer", () => {
    render(<AnswerBlock message={answer("La tarifa es 13% [1].")} />);
    expect(screen.queryByText(DEGRADED_SEARCH_NOTE)).toBeNull();
  });

  it("waits for prose — there is nothing to qualify before the first delta", () => {
    render(<AnswerBlock message={degraded("")} busy />);
    expect(screen.queryByText(DEGRADED_SEARCH_NOTE)).toBeNull();
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

  it("holds the stage label through the #219 beat, then retires it while still busy (req 4)", () => {
    vi.useFakeTimers();
    try {
      const message: AskUIMessage = {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "data-status",
            id: STATUS_PART_ID,
            data: { stage: "verificando" },
          },
          { type: "text", text: "Con el formulario" },
        ],
      };
      render(<AnswerBlock message={message} busy />);
      // Prose exists but is still invisible (word-fade slots pending), so
      // «Verificando citas…» keeps the screen for its legibility beat.
      expect(screen.getByRole("status").textContent).toBe("Verificando citas…");

      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("status")).toBeNull();
      expect(ariaBusy()).toBe("true");
    } finally {
      vi.useRealTimers();
    }
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

  it("clears the completion summary after its display window", () => {
    vi.useFakeTimers();
    try {
      render(
        <AnswerBlock
          message={answer("La tarifa es 13% [1].")}
          completionText="Respuesta lista, 1 fuente citada."
        />,
      );
      expect(screen.getByRole("status")).toBeTruthy();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AnswerBlock word-fade reveal (#219)", () => {
  /** Tokens carrying the reveal animation, in document order. */
  function revealTokens(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll('[data-slot="answer"] .animate-word-fade'),
    );
  }

  it("wraps each word of a live answer in a fade token with an increasing delay", () => {
    vi.useFakeTimers();
    try {
      render(
        <AnswerBlock
          message={answer("La tarifa general es 13% [1].", [citation], [1])}
          busy
        />,
      );

      const tokens = revealTokens();
      // "La ", "tarifa ", "general ", "es ", "13%", the [1] sup, "."
      expect(tokens.length).toBe(7);
      const delays = tokens.map((t) =>
        parseFloat(t.style.animationDelay || "0"),
      );
      // The schedule opens past the verificando hold and walks forward at
      // the reveal cadence — strictly increasing, ~8.3ms apart.
      expect(delays[0]).toBeGreaterThanOrEqual(390);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
      // The prose text is intact — the spans only pace, never rewrite.
      const prose = document.querySelector('[data-slot="answer"] > div');
      expect(prose?.textContent).toBe("La tarifa general es 13%1.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sellos, disclaimer and completion back until the reveal has finished", () => {
    vi.useFakeTimers();
    try {
      const message = answer("La tarifa es 13% [1].");
      const { rerender } = render(<AnswerBlock message={message} busy />);

      // Mid-reveal: prose is on its way, nothing below it yet.
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.queryByText(DISCLAIMER)).toBeNull();

      // The exchange finishes; the reveal still owes the last words.
      rerender(
        <AnswerBlock
          message={message}
          busy={false}
          completionText="Respuesta lista, 1 fuente citada."
        />,
      );
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.queryByText(/Respuesta lista/)).toBeNull();

      // Hold (400ms) + 6 tokens × ~8.3ms + fade (200ms) < 1s.
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText(DISCLAIMER)).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe(
        "Respuesta lista, 1 fuente citada.",
      );
      // Once done, the pacing spans are gone — plain prose again.
      expect(revealTokens()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a history-restored answer whole and instantly — no reveal", () => {
    render(<AnswerBlock message={answer("La tarifa es 13% [1].")} />);
    expect(revealTokens()).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it("renders a live answer whole and instantly under prefers-reduced-motion", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      render(<AnswerBlock message={answer("La tarifa es 13% [1].")} busy />);
      expect(revealTokens()).toHaveLength(0);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for the real rendered token schedule, not a naive word count of the text", () => {
    vi.useFakeTimers();
    try {
      // Two resolvable markers: the rendered token stream is longer than a
      // whitespace split of the text (each marker is its own fade token), so
      // an end computed from the naive count would fire while the tail is
      // still fading. The deadline must come from the delays actually
      // handed out.
      const message = answer(
        "Exentos según la ley [1]. La tarifa es 13% [2].",
        [citation, otherCitation],
        [1, 2],
      );
      const { rerender } = render(<AnswerBlock message={message} busy />);
      const spans = revealTokens();
      const lastDelay = Math.max(
        ...spans.map((s) => parseFloat(s.style.animationDelay || "0")),
      );
      rerender(<AnswerBlock message={message} busy={false} />);

      // Just before the last token's fade has finished: still revealing.
      act(() => vi.advanceTimersByTime(Math.floor(lastDelay) + 100));
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);

      // Once the last fade is over (200ms after its start), the reveal ends.
      act(() => vi.advanceTimersByTime(200));
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
