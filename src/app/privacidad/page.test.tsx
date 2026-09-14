// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PRIVACY_PATH } from "@/components/chat/privacy-note";
import PrivacyPage, { metadata } from "./page";

afterEach(cleanup);

/**
 * #136 req. 3. The page is prose, so these are the load-bearing facts rather
 * than the wording: every subprocessor named, the two retention promises, the
 * two deletion routes, and an address to write to. A subprocessor added to the
 * pipeline without being added here is what this suite exists to catch.
 */
describe("privacy page", () => {
  it("lives at the path the disclosure links to", () => {
    // The route is a directory name, so nothing but this keeps the two in
    // step: `src/app/privacidad/` and the link's constant.
    expect(PRIVACY_PATH).toBe("/privacidad");
  });

  it("names every subprocessor a question passes through", () => {
    render(<PrivacyPage />);

    for (const name of ["Vercel", "Supabase", "Anthropic", "Voyage AI"]) {
      expect(screen.getByText(name)).not.toBeNull();
    }
  });

  it("names the sign-in email provider outside the question path (#327)", () => {
    render(<PrivacyPage />);

    // Resend holds the address of everyone who signs in by magic link, so it
    // is disclosed — but not as one of the «cuatro proveedores» a question
    // passes through, because it never sees one.
    const dd = screen.getByText(/ese mensaje lo envía Resend/);
    expect(dd.textContent).toMatch(/no recibe ninguna pregunta/);
    expect(screen.getByText(/cuatro proveedores/).textContent).not.toMatch(
      /Resend/,
    );
  });

  it("states what is kept and for how long", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";

    // History: until the user deletes it. Logs: content-free, ~30 days.
    expect(text).toContain("hasta que usted lo elimine");
    expect(text).toContain("30 días");
    expect(text).toContain("Nunca el texto de la pregunta");
    // #141 widened what the logs hold — an event per ask, not only per
    // failure — so the page says so. The page is a claim about the code.
    expect(text).toContain("por cada consulta");
  });

  it("says the log carries the routing category of a decline, never the question (#264)", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";

    expect(text).toContain("Cuando no se encontró base oficial");
    expect(text).toContain("a qué institución se le remitió");
    expect(text).toContain("una categoría de una lista fija");
    // Every category in the table is named, so the list on the page is the
    // list in the code.
    for (const name of [
      "Hacienda",
      "CCSS",
      "INS",
      "municipalidad",
      "Registro Nacional",
      "colegio profesional",
      "banco",
      "MEIC",
      "migración",
      "MTSS",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("says what a follow-up sends and what it stores (#132)", () => {
    // Multi-turn added no subprocessor, but it changed what one of them
    // receives and what a history row holds — both are claims this page
    // makes, so both are asserted here.
    render(<PrivacyPage />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("los últimos intercambios de esa conversación");
    expect(text).toContain("la versión completa que el sistema armó");
    expect(text).toContain("le muestra siempre lo que usted");
  });

  it("describes both deletion routes", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";

    expect(text).toContain("borrar una pregunta");
    expect(text).toContain("Eliminar la cuenta");
  });

  it("gives an address for privacy requests", () => {
    render(<PrivacyPage />);

    const contact = screen.getByRole("link", {
      name: "privacidad@tramitico.com",
    });
    expect(contact.getAttribute("href")).toBe(
      "mailto:privacidad@tramitico.com",
    );
  });

  it("links the terms of use, so the two pages sit side by side (#326)", () => {
    render(<PrivacyPage />);

    const link = screen.getByRole("link", { name: "Términos de uso" });
    expect(link.getAttribute("href")).toBe("/terminos");
  });

  it("has a single h1 and a two-level heading outline (#326)", () => {
    render(<PrivacyPage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("titles itself for the tab and for search", () => {
    expect(metadata.title).toBe("Privacidad — Tramitico");
  });
});
