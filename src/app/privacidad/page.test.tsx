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

  it("states what is kept and for how long", () => {
    render(<PrivacyPage />);
    const text = document.body.textContent ?? "";

    // History: until the user deletes it. Logs: content-free, ~30 days.
    expect(text).toContain("hasta que usted lo elimine");
    expect(text).toContain("30 días");
    expect(text).toContain("nunca el texto de la pregunta");
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

  it("titles itself for the tab and for search", () => {
    expect(metadata.title).toBe("Privacidad — Tramitico");
  });
});
