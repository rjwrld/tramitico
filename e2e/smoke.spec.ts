import { test, expect } from "@playwright/test";

test("landing renders the wordmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "tramitico" })).toBeVisible();
  await expect(page.getByText("con cita al artículo oficial")).toBeVisible();
});
