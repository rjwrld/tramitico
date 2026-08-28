// @vitest-environment jsdom
//
// The branded 404 (issue #215). Next's default 404 is English, unbranded and
// theme-blind; these assertions are what say ours is none of those. The theme
// half is structural rather than visual: the page carries no hardcoded colour
// of its own, so it can only ever paint in the tokens the root layout's
// ThemeProvider resolves.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NotFound, { metadata } from "./not-found";

afterEach(cleanup);

describe("NotFound", () => {
  it("states the error in Spanish under the wordmark", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Esta página no existe" }),
    ).toBeDefined();
    expect(screen.getByText("Error 404")).toBeDefined();
    expect(metadata.title).toBe("Página no encontrada — Tramitico");
  });

  it("offers a way home", () => {
    render(<NotFound />);

    const home = screen.getByRole("link", { name: "Volver al inicio" });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("paints only in theme tokens, so both themes render it", () => {
    const { container } = render(<NotFound />);

    const classes = Array.from(container.querySelectorAll("*")).flatMap((el) =>
      Array.from(el.classList),
    );
    // A literal colour — `text-white`, `bg-[#fff]`, `text-zinc-500` — is what
    // would make this page look right in one theme and wrong in the other.
    for (const cls of classes) {
      expect(cls).not.toMatch(/^(text|bg|border)-\[?#/);
      expect(cls).not.toMatch(/^(text|bg|border)-(white|black|\w+-\d{2,3})$/);
    }
  });
});
