// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ACERCA_PATH,
  ACERCA_SOURCES_ANCHOR,
} from "@/components/chat/privacy-note";
import type { CorpusSource } from "@/lib/corpus-sources";
import { NON_PROMISE_ITEMS, PROMISE_SENTENCE } from "@/lib/promise";
import AcercaPage, {
  ACERCA_SECTIONS,
  AUTHOR,
  EMPTY_SOURCES,
  metadata,
  sourcesCount,
} from "./page";

let sources: CorpusSource[] = [];
vi.mock("@/lib/corpus-sources", () => ({
  loadCorpusSources: async () => sources,
}));

const reglamentoIva: CorpusSource = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779-H",
  articulo: null,
  url: "https://www.pgrweb.go.cr/scij/?param1=89012",
  effectiveAt: "2019-07-01",
  fetchedAt: "2026-09-04T17:02:10.282Z",
};

const ccssFaq: CorpusSource = {
  docKey: "ccss-faq",
  docTitle: "Preguntas frecuentes del trabajador independiente",
  norma: null,
  articulo: null,
  url: null,
  effectiveAt: null,
  fetchedAt: null,
};

async function renderPage() {
  render(await AcercaPage());
}

/**
 * #328 Phase 2 req. 4: the page in the `/privacidad` pattern. Prose, so the
 * assertions are the decided facts — four sections in order, the promise and
 * the full non-promise, the author block and its two links, the source list
 * from the decided origin with an honest empty state, and no motion.
 */
describe("acerca page", () => {
  beforeEach(() => {
    sources = [];
  });
  afterEach(cleanup);

  it("lives at the path the composer note links to", () => {
    expect(ACERCA_PATH).toBe("/acerca");
  });

  it("has a single h1 and the four sections as h2s, in order", async () => {
    await renderPage();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Acerca de Tramitico" }),
    ).not.toBeNull();
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(h2s).toEqual([...ACERCA_SECTIONS]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("opens with the promise and lists the whole non-promise", async () => {
    await renderPage();
    expect(screen.getByText(PROMISE_SENTENCE)).not.toBeNull();
    for (const item of NON_PROMISE_ITEMS) {
      expect(screen.getByText(item)).not.toBeNull();
    }
    expect(NON_PROMISE_ITEMS).toHaveLength(6);
  });

  it("names the model in how it works, not in the author block", async () => {
    await renderPage();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    const modelStep = steps.find((s) => s?.includes("Claude, de Anthropic"));
    expect(modelStep).toBeDefined();
    expect(modelStep).toContain("citando el artículo");
    // The author block: name plus two links, no email, no photo.
    expect(screen.getByText(AUTHOR.name)).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: "josuecalderon.com" })
        .getAttribute("href"),
    ).toBe(AUTHOR.site);
    expect(
      screen
        .getByRole("link", { name: "Código y documentación" })
        .getAttribute("href"),
    ).toBe(AUTHOR.repo);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("renders an honest empty state with no count when nothing is loaded", async () => {
    await renderPage();
    expect(screen.getByText(EMPTY_SOURCES)).not.toBeNull();
    expect(document.querySelector('[data-slot="sources-count"]')).toBeNull();
    expect(document.body.textContent).not.toContain("0 documentos");
  });

  it("lists every loaded document as a sello with its dates, title and norma", async () => {
    sources = [reglamentoIva, ccssFaq];
    await renderPage();

    const rows = document.querySelectorAll('[data-slot="source"]');
    expect(rows).toHaveLength(2);
    expect(
      document.querySelector('[data-slot="sources-count"]')?.textContent,
    ).toContain("2 documentos oficiales");

    const chip = screen.getByRole("link", { name: "Reglamento IVA" });
    expect(chip.getAttribute("href")).toBe(reglamentoIva.url);
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(rows[0].textContent).toContain("vigente desde 1 jul 2019");
    expect(rows[0].textContent).toContain("consultado el 4 set 2026");
    expect(rows[0].textContent).toContain(reglamentoIva.docTitle);
    expect(rows[0].textContent).toContain(reglamentoIva.norma);

    // No URL → a span, not a link; no dates → no caption.
    expect(screen.queryByRole("link", { name: "CCSS FAQ" })).toBeNull();
    expect(rows[1].textContent).not.toContain("consultado");
  });

  it("adds no motion: the chips do not stamp-settle", async () => {
    sources = [reglamentoIva, ccssFaq];
    await renderPage();
    for (const chip of document.querySelectorAll('[data-slot="sello"]')) {
      expect(chip.className).not.toContain("animate-stamp-settle");
    }
  });

  it("anchors the source section for the home caption", async () => {
    sources = [reglamentoIva];
    await renderPage();
    const section = document.getElementById(ACERCA_SOURCES_ANCHOR);
    expect(section?.querySelector("h2")?.textContent).toBe("Las fuentes");
  });

  it("links to the privacy and terms pages", async () => {
    await renderPage();
    expect(
      screen.getByRole("link", { name: "Privacidad" }).getAttribute("href"),
    ).toBe("/privacidad");
    expect(
      screen
        .getByRole("link", { name: "Términos de uso" })
        .getAttribute("href"),
    ).toBe("/terminos");
  });

  it("phrases the count with Spanish plurals", () => {
    expect(sourcesCount(1)).toBe("1 documento oficial");
    expect(sourcesCount(23)).toBe("23 documentos oficiales");
  });

  it("titles itself in Spanish for the tab and for search", () => {
    expect(metadata.title).toBe("Acerca");
    expect(metadata.alternates).toEqual({ canonical: "/acerca" });
  });
});
