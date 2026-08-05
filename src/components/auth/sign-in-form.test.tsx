// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOtp, signInWithOAuth } }),
}));

import { SignInForm } from "./sign-in-form";

beforeEach(() => {
  signInWithOtp.mockReset();
  signInWithOAuth.mockReset();
});

afterEach(cleanup);

async function submitEmail(email: string) {
  await userEvent.type(
    screen.getByLabelText("Correo electrónico"),
    email,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Enviar enlace" }),
  );
}

describe("SignInForm", () => {
  it("sends a magic link and confirms in ES copy", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<SignInForm />);

    await submitEmail("dev@example.com");

    expect(signInWithOtp).toHaveBeenCalledWith({ email: "dev@example.com" });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Revise su correo",
    );
  });

  it("shows the error copy when the magic link fails", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "boom" } });
    render(<SignInForm />);

    await submitEmail("dev@example.com");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo iniciar sesión",
    );
  });

  it("GitHub button starts OAuth with a query-free callback redirect", async () => {
    // The redirect must exactly match config.toml's allow-list — a query
    // param here silently reroutes the code to the bare site_url.
    signInWithOAuth.mockResolvedValue({ error: null });
    render(<SignInForm />);

    await userEvent.click(
      screen.getByRole("button", { name: "Continuar con GitHub" }),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  });
});
