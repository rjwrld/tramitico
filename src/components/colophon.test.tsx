// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REPOSITORY_URL } from "@/lib/site";
import { CODE_LINK_LABEL, Colophon } from "./colophon";

afterEach(cleanup);

function colophon(): HTMLElement {
  return screen.getByRole("navigation", { name: "Enlaces del sitio" });
}

describe("Colophon", () => {
  it("lists the four standing pages in order, each to its address", () => {
    render(<Colophon />);

    const links = within(colophon()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Acerca",
      "Privacidad",
      "Términos",
      CODE_LINK_LABEL,
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/acerca",
      "/privacidad",
      "/terminos",
      REPOSITORY_URL,
    ]);
  });

  it("keeps the middots out of the accessible names", () => {
    render(<Colophon />);

    for (const link of within(colophon()).getAllByRole("link")) {
      expect(link.textContent).not.toContain("·");
    }
  });

  it("is reachable link by link with the keyboard", async () => {
    render(<Colophon />);
    const links = within(colophon()).getAllByRole("link");

    for (const link of links) {
      await userEvent.tab();
      expect(document.activeElement).toBe(link);
    }
  });

  it("takes the caller's spacing", () => {
    render(<Colophon className="mt-12" />);

    expect(colophon().className).toContain("mt-12");
  });
});
