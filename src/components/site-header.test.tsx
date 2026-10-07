// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { SiteHeader } from "./site-header";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("links to /acerca from the header, left of the theme toggle", () => {
    render(<SiteHeader signedIn={false} />);

    const header = screen.getByRole("banner");
    const acerca = within(header).getByRole("link", { name: "Acerca" });
    expect(acerca.getAttribute("href")).toBe("/acerca");

    const toggle = within(header).getByRole("button", {
      name: "Cambiar tema",
    });
    expect(
      acerca.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the link for a signed-in reader, beside the account menu", () => {
    render(<SiteHeader signedIn email="dev@example.com" />);

    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("link", { name: "Acerca" }).getAttribute("href"),
    ).toBe("/acerca");
    expect(within(header).getByRole("button", { name: "Cuenta" })).toBeTruthy();
    expect(
      within(header).queryByRole("link", { name: "Iniciar sesión" }),
    ).toBeNull();
  });

  it("offers sign-in when signed out, and the toggle still switches theme", () => {
    render(<SiteHeader signedIn={false} />);

    expect(
      screen.getByRole("link", { name: "Iniciar sesión" }).getAttribute("href"),
    ).toBe("/login");
    fireEvent.click(screen.getByRole("button", { name: "Cambiar tema" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
