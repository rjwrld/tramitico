// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithOtp, signInWithOAuth, verifyOtp },
  }),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { SignInForm } from "./sign-in-form";

const CODE_LABEL = "¿Abrió el correo en otro navegador? Ingrese el código.";

beforeEach(() => {
  signInWithOtp.mockReset();
  signInWithOAuth.mockReset();
  verifyOtp.mockReset();
  push.mockReset();
  refresh.mockReset();
});

afterEach(cleanup);

async function submitEmail(email: string) {
  await userEvent.type(screen.getByLabelText("Correo electrónico"), email);
  await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
}

async function submitEmailAndGetToConfirmation(email: string) {
  signInWithOtp.mockResolvedValue({ error: null });
  render(<SignInForm />);
  await submitEmail(email);
  await screen.findByRole("status");
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

  it("Google button starts OAuth with a query-free callback redirect", async () => {
    signInWithOAuth.mockResolvedValue({ error: null });
    render(<SignInForm />);

    await userEvent.click(
      screen.getByRole("button", { name: "Continuar con Google" }),
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  });

  it("renders Google above GitHub (decision 1, issue #84)", () => {
    render(<SignInForm />);

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    const google = labels.indexOf("Continuar con Google");
    const github = labels.indexOf("Continuar con GitHub");
    expect(google).toBeGreaterThanOrEqual(0);
    expect(github).toBeGreaterThan(google);
  });

  it("shows the code field once the link is requested (issue #85)", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");

    expect(screen.getByLabelText(CODE_LABEL)).toBeTruthy();
  });

  it("verifies the emailed code and navigates home on success", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");
    verifyOtp.mockResolvedValue({ error: null });

    await userEvent.type(screen.getByLabelText(CODE_LABEL), "123456");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar código" }),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "email",
      email: "dev@example.com",
      token: "123456",
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });

  it("disables the confirm button and blocks verifyOtp for a short code", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");

    const codeInput = screen.getByLabelText(CODE_LABEL);
    await userEvent.type(codeInput, "123");

    expect(
      screen.getByRole("button", { name: "Confirmar código" }),
    ).toHaveProperty("disabled", true);

    // Even a forced submit (e.g. Enter in the field) must not fire verifyOtp
    // with a partial code — a 3-digit typo shouldn't burn a network round
    // trip or a verify-rate-limit attempt.
    await userEvent.type(codeInput, "{Enter}");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("strips non-digits and caps the code field at 6 characters", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");

    const codeInput = screen.getByLabelText(CODE_LABEL) as HTMLInputElement;
    await userEvent.type(codeInput, "1a2b3c4d5e6f7g8h");

    expect(codeInput.value).toBe("123456");
  });

  it("shows the ES error inline for an invalid or expired code", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");
    verifyOtp.mockResolvedValue({ error: { message: "invalid token" } });

    await userEvent.type(screen.getByLabelText(CODE_LABEL), "000000");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar código" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "El código no es válido o venció",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("resets to the email form so a new link can be requested", async () => {
    await submitEmailAndGetToConfirmation("dev@example.com");

    await userEvent.click(
      screen.getByRole("button", { name: "Solicitar un enlace nuevo" }),
    );

    expect(screen.getByLabelText("Correo electrónico")).toBeTruthy();
  });
});
