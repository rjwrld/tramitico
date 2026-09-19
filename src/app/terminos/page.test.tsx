// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DISCLAIMER } from "@/components/chat/answer-block";
import { TERMS_PATH } from "@/components/chat/privacy-note";
import TermsPage, {
  TERMS_EFFECTIVE_DATE,
  TERMS_SECTIONS,
  metadata,
} from "./page";

afterEach(cleanup);

/**
 * #326 req. 3. Prose, so the assertions are the load-bearing facts: the eight
 * sections in order, the disclaimer the answers carry, the enforced quotas,
 * the effective date, the address, and a heading outline a screen reader can
 * walk.
 */
describe("terms page", () => {
  it("lives at the path the composer note links to", () => {
    expect(TERMS_PATH).toBe("/terminos");
  });

  it("has a single h1 and the eight sections as h2s, in order", () => {
    render(<TermsPage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Términos de uso" }),
    ).not.toBeNull();

    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(h2s).toEqual([...TERMS_SECTIONS]);
    // No h3+ — a two-level outline, nothing skipped.
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("quotes the disclaimer the answers render, not a copy", () => {
    render(<TermsPage />);
    expect(screen.getByText(DISCLAIMER)).not.toBeNull();
  });

  it("states the enforced daily quotas and the Costa Rica day", () => {
    render(<TermsPage />);
    const text = document.body.textContent ?? "";

    // The defaults in rate-limit.ts (SPEC §7); the page reads limitFor().
    expect(text).toContain("10 sin sesión iniciada");
    expect(text).toContain("50 con sesión iniciada");
    expect(text).toContain("calendario de Costa Rica");
    expect(text).toContain("automatizada");
  });

  it("carries a well-formed effective date and renders it", () => {
    expect(TERMS_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(TERMS_EFFECTIVE_DATE))).toBe(false);

    render(<TermsPage />);
    const time = document.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(TERMS_EFFECTIVE_DATE);
    expect(time?.textContent).toBe("14 de septiembre de 2026");
  });

  it("points to the privacy page instead of restating it", () => {
    render(<TermsPage />);
    const links = screen.getAllByRole("link", { name: "Privacidad" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/privacidad");
    }
  });

  it("names Costa Rica as governing law", () => {
    render(<TermsPage />);
    expect(document.body.textContent).toContain(
      "leyes de la República de Costa Rica",
    );
  });

  it("gives the same address the privacy page names", () => {
    render(<TermsPage />);
    const contact = screen.getByRole("link", {
      name: "privacidad@tramitico.com",
    });
    expect(contact.getAttribute("href")).toBe(
      "mailto:privacidad@tramitico.com",
    );
  });

  it("titles itself for the tab and for search", () => {
    expect(metadata.title).toBe("Términos de uso");
    expect(metadata.alternates).toEqual({ canonical: "/terminos" });
  });
});
