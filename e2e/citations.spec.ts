import { expect, test, type Page } from "@playwright/test";

import { CITATION, sse, stubAsk } from "./support";

/**
 * The inline reference chip and the official links in prose, in a real
 * browser: Base UI's popover only fails its composition rules at runtime,
 * and jsdom cannot tell an atomic inline from a plain one.
 */
const ANSWER = sse([
  { type: "start" },
  { type: "text-start", id: "t1" },
  {
    type: "text-delta",
    id: "t1",
    delta:
      "La tarifa general es del 13 %[1]. Inscríbase en https://www.hacienda.go.cr/atv o escriba a consultas@hacienda.go.cr.",
  },
  { type: "data-citations", id: "citations", data: [CITATION] },
  { type: "data-markers", id: "markers", data: [1] },
  { type: "text-end", id: "t1" },
  { type: "finish" },
]);

async function ask(page: Page) {
  await stubAsk(page, ANSWER);
  await page.goto("/");
  await page.getByLabel("Su pregunta").fill("¿Cuánto es el IVA?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-slot="sello"]')).toBeVisible();
}

const card = (page: Page) => page.locator('[data-slot="citation-preview"]');

test("the chip opens the source card on hover and pins it on click", async ({
  page,
}) => {
  await ask(page);
  const chip = page.getByRole("button", { name: /^Fuente 1:/ });
  await expect(chip).toHaveText("1");

  await chip.hover();
  await expect(card(page)).toContainText(CITATION.docTitle);
  await expect(
    card(page).getByRole("link", { name: /Abrir en sinalevi\.go\.cr/ }),
  ).toHaveAttribute("href", CITATION.url);

  await chip.click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await expect(card(page)).toBeVisible();
  // No jump: the chip is not a fragment link and the URL keeps no hash.
  expect(new URL(page.url()).hash).toBe("");

  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
});

test("official URLs and addresses in prose are links; the rest stays text", async ({
  page,
}) => {
  await ask(page);

  const link = page.locator('[data-slot="official-link"]');
  await expect(link).toHaveText("hacienda.go.cr/atv");
  await expect(link).toHaveAttribute("href", "https://www.hacienda.go.cr/atv");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "consultas@hacienda.go.cr" }),
  ).toHaveAttribute("href", "mailto:consultas@hacienda.go.cr");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a tap opens the card", async ({ page }) => {
    await ask(page);
    await page.getByRole("button", { name: /^Fuente 1:/ }).tap();
    await expect(card(page)).toContainText(CITATION.docTitle);
  });
});
