// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const signOut = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import { UserMenu } from "./user-menu";

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  signOut.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Cuenta" }));
}

describe("UserMenu", () => {
  it("opens on avatar click showing the email and sign-out", async () => {
    render(<UserMenu email="dev@example.com" />);

    await openMenu();

    expect(await screen.findByText("dev@example.com")).toBeTruthy();
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
  });

  it("shows the delete-account entry below sign-out", async () => {
    render(<UserMenu email="dev@example.com" />);

    await openMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    ).toBeTruthy();
  });

  it("first click arms the confirm; cancel disarms it without calling the endpoint", async () => {
    render(<UserMenu email="dev@example.com" />);
    await openMenu();

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    );

    expect(
      screen.getByText(/Esto elimina su cuenta y todo su historial/),
    ).toBeTruthy();
    const confirmButton = screen.getByRole("button", {
      name: "Eliminar cuenta y todo el historial",
    });
    expect(confirmButton).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(
      screen.queryByText(/Esto elimina su cuenta y todo su historial/),
    ).toBe(null);
    expect(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("arms the confirm with the shared radius, not a menu-local one (#116)", async () => {
    render(<UserMenu email="dev@example.com" />);
    await openMenu();

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    );

    const confirm = screen.getByText(
      /Esto elimina su cuenta y todo su historial/,
    ).parentElement;
    expect(confirm?.className).toContain("rounded-lg");
    expect(confirm?.className).not.toContain("rounded-md");
  });

  it("gives the popup an explicit width and lets the confirm's buttons wrap (#29)", async () => {
    render(<UserMenu email="dev@example.com" />);
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    );

    // jsdom lays nothing out, so this asserts the classes that fix the clip:
    // without them the popup sizes to the 2rem avatar (min-w-32) and the
    // confirm's 205px button row scrolls the prompt out of view.
    expect(screen.getByRole("menu").className).toContain("w-64");
    const row = screen.getByRole("button", { name: "Cancelar" }).parentElement;
    expect(row?.className).toContain("flex-wrap");
  });

  it("confirm click calls the delete endpoint, signs out, and redirects", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<UserMenu email="dev@example.com" />);
    await openMenu();

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar cuenta y todo el historial",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
    });
    await vi.waitFor(() => expect(signOut).toHaveBeenCalled());
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the account when the endpoint fails, and does not sign out", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(<UserMenu email="dev@example.com" />);
    await openMenu();

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Eliminar cuenta" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar cuenta y todo el historial",
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(signOut).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
