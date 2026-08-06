import { test, expect, type Page } from "@playwright/test";

/**
 * /api/ask is owned by #21 and not built yet, so the smoke stubs it with the
 * exact wire shape the UI consumes (src/lib/answer/contract.ts): an AI SDK
 * UI message stream carrying text plus cumulative `data-citations`
 * snapshots. Issue #27 owns the unstubbed end-to-end pass.
 */
const CITATION = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953&param2=&param3=1&param4=",
};

function sse(chunks: object[]): string {
  return (
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

async function stubAsk(page: Page, body: string, status = 200) {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status,
      headers:
        status === 200
          ? {
              "content-type": "text/event-stream",
              "x-vercel-ai-ui-message-stream": "v1",
            }
          : { "content-type": "application/json" },
      body,
    }),
  );
}

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
    sse([
      { type: "start" },
      { type: "text-start", id: "t1" },
      {
        type: "text-delta",
        id: "t1",
        delta: "El IVA no aplica a la exportación de servicios. ",
      },
      {
        type: "data-citations",
        id: "citations",
        data: [CITATION],
      },
      { type: "text-delta", id: "t1", delta: "Debe emitir factura igual." },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]),
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
    429,
  );

  await page.goto("/");
  await page.getByLabel("Su pregunta").fill("¿Debo cobrar IVA?");
  await page.getByRole("button", { name: "Enviar" }).click();

  // Next.js's route announcer is also role=alert — filter to ours.
  const alert = page.getByRole("alert").filter({ hasText: "límite" });
  await expect(alert).toContainText(
    "Alcanzó el límite de 10 preguntas gratis por hoy",
  );
  await expect(alert).toContainText("Inicie sesión");
});
