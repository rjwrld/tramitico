import { test, expect } from "@playwright/test";

import { answerStream, stubAsk } from "./support";

/**
 * The #137 baseline. `next.config.ts` sets these headers for every response,
 * so the page and an API route must both carry them — that is the assertion
 * that would catch the config layer quietly skipping route handlers.
 */

const BASELINE = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "reporting-endpoints": 'csp-endpoint="/api/csp-report"',
};

for (const [path, label] of [
  ["/", "the landing page"],
  // 401 signed out — the status is irrelevant, the headers are the subject.
  ["/api/history", "an API route"],
] as const) {
  test(`baseline security headers are on ${label}`, async ({ request }) => {
    const response = await request.get(path);
    const headers = response.headers();

    for (const [key, value] of Object.entries(BASELINE)) {
      expect(headers[key], `${key} on ${path}`).toBe(value);
    }

    const csp = headers["content-security-policy-report-only"];
    expect(csp, `CSP-Report-Only on ${path}`).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
    // Report-only never enforces — nothing must be sent as enforced yet (#121).
    expect(headers["content-security-policy"]).toBeUndefined();
  });
}

test("the report endpoint accepts a violation report", async ({ request }) => {
  const response = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: { "csp-report": { "violated-directive": "script-src" } },
  });

  expect(response.status()).toBe(204);
});

test("the happy path raises no CSP violation", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

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

  expect(violations).toEqual([]);
});
