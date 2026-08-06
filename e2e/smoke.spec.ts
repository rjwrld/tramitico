import { test, expect } from "@playwright/test";

import { CITATION, answerStream, inlineAlert, stubAsk } from "./support";

/**
 * Smoke: the landing renders and the chat consumes the #21 wire shape. The
 * stream is stubbed here so the smoke stays fast and deterministic; the
 * unstubbed route paths live in chat-flow.spec.ts (#27).
 */

test("landing shows the wordmark and the empty-state invitation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("tramitico")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "¿Qué trámite le quita el sueño?" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Preguntas frecuentes" })
      .getByRole("button"),
  ).toHaveCount(10);
});

test("seeded prompt click streams an answer with sello and disclaimer", async ({
  page,
}) => {
  await stubAsk(
    page,
    answerStream(
      "El IVA no aplica a la exportación de servicios. ",
      "Debe emitir factura igual.",
    ),
  );

  await page.goto("/");
  await page
    .getByRole("button", {
      name: "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
    })
    .click();

  await expect(
    page.getByText("El IVA no aplica a la exportación de servicios."),
  ).toBeVisible();
  const sello = page.getByRole("link", { name: "Reglamento IVA · Art. 11" });
  await expect(sello).toBeVisible();
  await expect(sello).toHaveAttribute("href", CITATION.url);
  await expect(
    page.getByText(
      "No es asesoría legal ni contable — verifique con Hacienda.",
    ),
  ).toBeVisible();
});

test("a 429 renders the friendly rate-limit message inline", async ({
  page,
}) => {
  await stubAsk(
    page,
    JSON.stringify({
      error: "rate_limited",
      message:
        "Alcanzó el límite de 10 preguntas gratis por hoy. Inicie sesión para tener 50 preguntas diarias.",
    }),
    { status: 429 },
  );

  await page.goto("/");
  await page.getByLabel("Su pregunta").fill("¿Debo cobrar IVA?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const alert = inlineAlert(page, "límite");
  await expect(alert).toContainText(
    "Alcanzó el límite de 10 preguntas gratis por hoy",
  );
  await expect(alert).toContainText("Inicie sesión");
});
