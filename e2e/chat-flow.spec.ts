import { test, expect } from "@playwright/test";

import { answerStream, inlineAlert, stubAsk } from "./support";

/**
 * E2E chat flow + hardening (#27, SPEC §9–10).
 *
 * Two layers:
 * - Stubbed-stream tests pin client behavior against the #21 wire shape
 *   (multi-turn, pending state, network failure).
 * - Unstubbed tests hit the real /api/ask. The Playwright config pins the
 *   server-side Supabase env empty, so the rate limiter deterministically
 *   fails closed (SPEC §7) — which exercises the real error-body contract
 *   all the way to the inline message, with no external services.
 */

const DISCLAIMER = "No es asesoría legal ni contable — verifique con Hacienda.";

test.describe("ask flow (stubbed stream)", () => {
  test("typed question streams an answer with sello chip and disclaimer", async ({
    page,
  }) => {
    await stubAsk(
      page,
      answerStream("La tarifa general del IVA es 13%. ", "Aplica a servicios."),
    );

    await page.goto("/");
    const input = page.getByLabel("Su pregunta");
    await input.fill("¿Cuánto es el IVA?");
    await page.getByRole("button", { name: "Enviar" }).click();

    // The question echoes as a user bubble and the box clears for the next one.
    await expect(page.getByText("¿Cuánto es el IVA?")).toBeVisible();
    await expect(input).toHaveValue("");

    await expect(
      page.getByText("La tarifa general del IVA es 13%."),
    ).toBeVisible();
    const sello = page.getByRole("link", { name: "Reglamento IVA · Art. 11" });
    await expect(sello).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });

  test("a second question keeps the first exchange in the flow", async ({
    page,
  }) => {
    await stubAsk(
      page,
      answerStream("Respuesta con base oficial. ", "Fin.", []),
    );

    await page.goto("/");
    const input = page.getByLabel("Su pregunta");
    await input.fill("¿Debo emitir factura electrónica?");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();

    await input.fill("¿Y si mi cliente está en el exterior?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      page.getByText("¿Debo emitir factura electrónica?"),
    ).toBeVisible();
    await expect(
      page.getByText("¿Y si mi cliente está en el exterior?"),
    ).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toHaveCount(2);
  });

  test("while waiting, the pending line shows and Enviar is disabled", async ({
    page,
  }) => {
    await stubAsk(page, answerStream("Llegó la respuesta. ", "Fin.", []), {
      delayMs: 1500,
    });

    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿Cuánto es el IVA?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      page.getByText("Consultando los documentos oficiales…"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar" })).toBeDisabled();

    await expect(page.getByText("Llegó la respuesta.")).toBeVisible();
    await expect(
      page.getByText("Consultando los documentos oficiales…"),
    ).toBeHidden();
  });

  test("a network failure renders the generic ES fallback inline", async ({
    page,
  }) => {
    await page.route("**/api/ask", (route) => route.abort("connectionfailed"));

    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿Cuánto es el IVA?");
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      inlineAlert(page, "No se pudo obtener la respuesta. Intente de nuevo."),
    ).toBeVisible();
  });

  test("Enviar stays disabled for empty or whitespace questions", async ({
    page,
  }) => {
    await page.goto("/");
    const enviar = page.getByRole("button", { name: "Enviar" });
    await expect(enviar).toBeDisabled();
    await page.getByLabel("Su pregunta").fill("   ");
    await expect(enviar).toBeDisabled();
  });
});

test.describe("ask flow (real route)", () => {
  test("a question reaches /api/ask and the fail-closed limiter message renders inline", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿Cuánto es el IVA?");
    await page.getByRole("button", { name: "Enviar" }).click();

    // No stub: the real route denies fail-closed (limiter unavailable → 503)
    // and the client contract must surface the friendly copy, not a generic
    // error.
    await expect(
      inlineAlert(page, "No pudimos verificar su límite de preguntas"),
    ).toContainText("Intente de nuevo en unos minutos.");
  });

  test("an overlong question gets the what-happened + what-to-do message inline", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Su pregunta").fill("¿".repeat(1001));
    await page.getByRole("button", { name: "Enviar" }).click();

    await expect(
      inlineAlert(page, "Falta la pregunta o es demasiado larga"),
    ).toContainText("intente de nuevo");
  });

  test("the error bodies carry the { error, message } contract", async ({
    request,
  }) => {
    const missing = await request.post("/api/ask", { data: {} });
    expect(missing.status()).toBe(400);
    const missingBody = (await missing.json()) as {
      error: string;
      message: string;
    };
    expect(missingBody.error).toBe("invalid_question");
    expect(missingBody.message).toMatch(/pregunta/i);

    const denied = await request.post("/api/ask", {
      data: { question: "¿Cuánto es el IVA?" },
    });
    expect(denied.status()).toBe(503);
    const deniedBody = (await denied.json()) as {
      error: string;
      message: string;
    };
    expect(deniedBody.error).toBe("rate_limit_unavailable");
    expect(deniedBody.message).toContain("No pudimos verificar su límite");
  });
});

// Anonymous side only: signing a user in needs a live Supabase, which the
// e2e run deliberately does without. The authed tier is covered at the unit
// layer (route.test.ts, history.integration.test.ts).
test.describe("auth path (anonymous)", () => {
  test("anonymous header links to /login with the sign-in options", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL("/login");

    await expect(page.getByText("Iniciar sesión").first()).toBeVisible();
    await expect(
      page.getByText("Guarde su historial de preguntas"),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enviar enlace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continuar con GitHub" }),
    ).toBeVisible();
  });

  test("history stays auth-gated for anonymous callers", async ({
    request,
  }) => {
    const response = await request.get("/api/history");
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Inicie sesión para ver su historial.");
  });
});
