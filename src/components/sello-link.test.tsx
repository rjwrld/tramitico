// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sello } from "./sello";
import { sourceHost } from "./sello-link";
import type { Citation } from "@/lib/citations";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const citation: Citation = {
  docKey: "ley-iva",
  docTitle: "Ley del Impuesto sobre el Valor Agregado",
  norma: "Ley 6826",
  articulo: "Artículo 8",
  url: "https://www.pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param2=1",
};

function preview(): HTMLElement | null {
  return document.querySelector('[data-slot="sello-preview"]');
}

describe("Sello source preview (#478)", () => {
  it("keeps the chip itself the link to the official source", () => {
    render(<Sello citation={citation} />);
    const chip = screen.getByRole("link", { name: "Ley IVA · Art. 8" });

    expect(chip.getAttribute("href")).toBe(citation.url);
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(chip.getAttribute("rel")).toBe("noopener noreferrer");
    expect(chip.getAttribute("data-slot")).toBe("sello");
    expect(preview()).toBeNull();
  });

  it("opens a card with the full title, norma and host on keyboard focus", async () => {
    render(<Sello citation={citation} />);
    const chip = screen.getByRole("link", { name: "Ley IVA · Art. 8" });

    await act(async () => {
      chip.focus();
      fireEvent.focus(chip);
    });

    const card = await screen.findByText(citation.docTitle);
    expect(card.closest('[data-slot="sello-preview"]')).not.toBeNull();
    expect(preview()?.textContent).toContain("Ley 6826 · Artículo 8");
    expect(preview()?.textContent).toContain("pgrweb.go.cr");
  });

  it("opens on hover after the delay", async () => {
    vi.useFakeTimers();
    render(<Sello citation={citation} />);
    const chip = screen.getByRole("link", { name: "Ley IVA · Art. 8" });

    await act(async () => {
      fireEvent.pointerEnter(chip, { pointerType: "mouse" });
      fireEvent.mouseEnter(chip);
      fireEvent.mouseMove(chip);
    });
    expect(preview()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(preview()?.textContent).toContain(citation.docTitle);
  });

  it("stays off where the page already prints the title beside the stamp", async () => {
    render(<Sello citation={citation} preview={false} />);
    const chip = screen.getByRole("link", { name: "Ley IVA · Art. 8" });

    await act(async () => {
      chip.focus();
      fireEvent.focus(chip);
    });
    expect(preview()).toBeNull();
  });
});

describe("sourceHost", () => {
  it("names the host without www, and nothing for a malformed URL", () => {
    expect(sourceHost("https://www.hacienda.go.cr/x")).toBe("hacienda.go.cr");
    expect(sourceHost("not a url")).toBeNull();
  });
});
