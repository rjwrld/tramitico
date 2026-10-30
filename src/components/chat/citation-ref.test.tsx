// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CitationRef, ReferenceScope } from "./citation-ref";
import type { Citation } from "@/lib/citations";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ley: Citation = {
  docKey: "ley-10363",
  docTitle: "Ley del Trabajador Independiente",
  norma: "Ley 10363",
  articulo: "Artículo 2",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=99349",
};
const reglamento: Citation = {
  docKey: "ccss-reglamento-ti",
  docTitle:
    "Reglamento para el Aseguramiento Contributivo de los Trabajadores Independientes",
  norma: null,
  articulo: "Transitorio V",
  url: null,
};

function card(): HTMLElement | null {
  return document.querySelector('[data-slot="citation-preview"]');
}

function renderChips() {
  render(
    <p>
      <ReferenceScope>
        Cuatro años
        <CitationRef ordinal={1} citation={ley} />, diez años
        <CitationRef ordinal={1} citation={ley} />, y el reglamento
        <CitationRef ordinal={2} citation={reglamento} />.
      </ReferenceScope>
    </p>,
  );
  return screen.getAllByRole("button", { name: /^Fuente/ });
}

async function hover(chip: HTMLElement) {
  await act(async () => {
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    fireEvent.mouseEnter(chip);
    fireEvent.mouseMove(chip);
  });
}

async function leave(chip: HTMLElement) {
  await act(async () => {
    fireEvent.pointerLeave(chip, { pointerType: "mouse" });
    fireEvent.mouseLeave(chip);
  });
}

describe("CitationRef", () => {
  it("is a keyboard-reachable button named for its sello", () => {
    const [first, , third] = renderChips();

    expect(first.textContent).toBe("1");
    expect(first.getAttribute("aria-label")).toBe(
      "Fuente 1: Ley 10363 · Art. 2",
    );
    expect(third.getAttribute("aria-label")).toBe(
      "Fuente 2: CCSS Reglamento TI · Transitorio V",
    );
    expect(first.tabIndex).toBe(0);
    expect(card()).toBeNull();
  });

  it("opens the source card on hover after the delay", async () => {
    vi.useFakeTimers();
    const [first] = renderChips();

    await hover(first);
    expect(card()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(card()?.textContent).toContain(ley.docTitle);
    expect(card()?.textContent).toContain("Ley 10363 · Artículo 2");
    const open = screen.getByRole("link", {
      name: /Abrir en sinalevi\.go\.cr/,
    });
    expect(open.getAttribute("href")).toBe(ley.url);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("pins the card on click, so it stays when the pointer leaves", async () => {
    vi.useFakeTimers();
    const [first] = renderChips();

    await act(async () => {
      fireEvent.click(first);
    });
    expect(card()?.textContent).toContain(ley.docTitle);
    expect(first.getAttribute("aria-expanded")).toBe("true");

    await leave(first);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(card()).not.toBeNull();
  });

  it("pins a hover-opened card on click instead of closing it", async () => {
    vi.useFakeTimers();
    const [first] = renderChips();

    await hover(first);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(card()).not.toBeNull();
    await act(async () => {
      fireEvent.click(first);
    });
    await leave(first);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(card()).not.toBeNull();
  });

  it("unpins and closes on a second click", async () => {
    const [first] = renderChips();

    await act(async () => {
      fireEvent.click(first);
    });
    expect(card()).not.toBeNull();
    await act(async () => {
      fireEvent.click(first);
    });

    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes a pinned card on Escape", async () => {
    const [first] = renderChips();

    await act(async () => {
      fireEvent.click(first);
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });

    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens from the keyboard with Enter", async () => {
    const [first] = renderChips();

    await act(async () => {
      first.focus();
      fireEvent.keyDown(first, { key: "Enter" });
    });

    expect(card()?.textContent).toContain(ley.docTitle);
  });

  it("offers no way out for a source with no official URL", async () => {
    const [, , third] = renderChips();

    await act(async () => {
      fireEvent.click(third);
    });

    expect(card()?.textContent).toContain(reglamento.docTitle);
    expect(screen.queryByRole("link", { name: /Abrir en/ })).toBeNull();
  });

  it("lights the other chips citing the same source while its card is open", async () => {
    const [first, second, third] = renderChips();

    await act(async () => {
      fireEvent.click(first);
    });

    expect(first.hasAttribute("data-sibling")).toBe(false);
    expect(second.hasAttribute("data-sibling")).toBe(true);
    expect(third.hasAttribute("data-sibling")).toBe(false);

    await act(async () => {
      fireEvent.click(first);
    });
    expect(second.hasAttribute("data-sibling")).toBe(false);
  });
});
