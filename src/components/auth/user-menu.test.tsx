// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

import { UserMenu } from "./user-menu";

afterEach(cleanup);

describe("UserMenu", () => {
  it("opens on avatar click showing the email and sign-out", async () => {
    render(<UserMenu email="dev@example.com" />);

    await userEvent.click(screen.getByRole("button", { name: "Cuenta" }));

    expect(await screen.findByText("dev@example.com")).toBeTruthy();
    expect(screen.getByText("Cerrar sesión")).toBeTruthy();
  });
});
