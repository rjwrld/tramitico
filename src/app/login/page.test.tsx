// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import LoginPage from "./page";

// The page only needs "no session" to render the form; the form itself has
// its own interaction tests, so it stands in as a marker here.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/history", () => ({ sessionUserId: async () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/auth/sign-in-form", () => ({
  SignInForm: () => <form aria-label="Formulario de acceso" />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/**
 * #501: the sign-in pitch never promises more questions than signing in buys.
 */
describe("login page", () => {
  it("pitches only the saved history at the defaults, which are equal (SPEC §7)", async () => {
    vi.stubEnv("RATE_LIMIT_ANON", "");
    vi.stubEnv("RATE_LIMIT_AUTHED", "");
    render(await LoginPage());
    expect(
      screen.getByText("Guarde su historial de preguntas."),
    ).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/por día/);
  });

  it("states the signed-in quota when it is larger", async () => {
    vi.stubEnv("RATE_LIMIT_ANON", "10");
    vi.stubEnv("RATE_LIMIT_AUTHED", "25");
    render(await LoginPage());
    expect(
      screen.getByText(
        "Guarde su historial de preguntas y consulte hasta 25 por día.",
      ),
    ).not.toBeNull();
  });

  it("pitches only the saved history when the signed-in quota is smaller", async () => {
    vi.stubEnv("RATE_LIMIT_ANON", "10");
    vi.stubEnv("RATE_LIMIT_AUTHED", "5");
    render(await LoginPage());
    expect(
      screen.getByText("Guarde su historial de preguntas."),
    ).not.toBeNull();
  });
});
