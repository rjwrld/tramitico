import { randomUUID } from "node:crypto";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/database.types";
import { UNMATCHABLE_QUESTION, WEAK_ANSWER_TEXT } from "./support";

/**
 * The history sheet at a phone viewport, against a real signed-in session
 * (issue #161) — the gap `mobile-a11y.spec.ts` documents in its own header
 * and cannot close: history only mounts for a signed-in session, and the
 * default config runs with `SUPABASE_URL` pinned empty. So the sheet's
 * open / select / dismiss paths and the refresh-after-persist ladder were
 * covered in jsdom only, never at 375px against the real auth path.
 *
 * Runs via playwright.local.config.ts, which passes a real local Supabase
 * through (same lane as rate-limit.local.spec.ts).
 *
 * Auth goes through the app's own code path rather than forged cookies:
 * `admin.generateLink` mints the same `token_hash` the magic-link email
 * carries (supabase/templates/magic_link.html), and `/auth/confirm` verifies
 * it server-side and sets the session cookies exactly as a real sign-in
 * would. No test-only branch in production code.
 *
 * What is still NOT proven here: notch insets. `env(safe-area-inset-*)`
 * resolves to 0 in headless Chromium, so any assertion on the inset itself
 * would be vacuously true. The `px-safe` check below is a regression guard
 * that the utility is still applied and still computes — not proof that a
 * cutout is cleared. Requirement 3 of #138, the owner's pass on a real
 * mobile Safari, remains unautomated.
 */

const PHONE = { width: 375, height: 667 };

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** Newest last — the seed loop stamps `created_at` so "top" is deterministic. */
const SEEDED = [
  {
    question: "¿Cómo me inscribo con el D-140?",
    answer: "Debe presentar el D-140 ante Hacienda.",
  },
  {
    question: "¿Cuándo se declara el IVA?",
    answer: "El IVA se declara mensualmente, en el formulario D-104.",
  },
];

let userId: string;

async function seedQuestion(
  question: string,
  answer: string,
  minutesAgo: number,
) {
  const { error } = await admin.from("questions").insert({
    user_id: userId,
    question,
    answer,
    citations: [],
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });
  expect(error).toBeNull();
}

/**
 * The app's own magic-link landing does the work: `token_hash` in, session
 * cookies out. `type=email` matches what the email template sends.
 */
async function signIn(page: Page, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  expect(error).toBeNull();
  const tokenHash = data.properties?.hashed_token;
  expect(tokenHash, "generateLink returned no token hash").toBeTruthy();

  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash!)}&type=email&next=/`,
  );
  // Landing on `/` signed in is the proof the cookies were set: the trigger
  // below only exists for a session.
  await expect(
    page.getByRole("button", { name: "Abrir historial" }),
  ).toBeVisible();
}

test.describe("history sheet at a phone viewport", () => {
  test.use({ viewport: PHONE });

  // One throwaway user per test: history is scoped by user id, so a fresh one
  // is a clean list, and the authed quota (50/day) is never a factor.
  test.beforeEach(async ({ page }) => {
    const email = `history-mobile-${randomUUID()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(error).toBeNull();
    userId = data.user!.id;

    await seedQuestion(SEEDED[0].question, SEEDED[0].answer, 20);
    await seedQuestion(SEEDED[1].question, SEEDED[1].answer, 10);

    await signIn(page, email);
  });

  test.afterEach(async () => {
    if (!userId) return;
    await admin.from("questions").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  });

  const trigger = (page: Page) =>
    page.getByRole("button", { name: "Abrir historial" });
  const sheet = (page: Page) =>
    page.getByRole("dialog", { name: "Historial de preguntas" });

  /**
   * The list entry's own button. Named by a prefix match on purpose: the
   * delete control beside it is labelled "Eliminar: <la misma pregunta>", and
   * the entry itself carries its date in its accessible name.
   */
  const historyItem = (page: Page, question: string) =>
    sheet(page).getByRole("button", {
      name: new RegExp(`^${question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    });

  test("opens from the trigger with the saved questions, newest first", async ({
    page,
  }) => {
    await trigger(page).click();

    const panel = sheet(page);
    await expect(panel).toBeVisible();
    await expect(panel.locator("li").first()).toContainText(SEEDED[1].question);
    await expect(panel.getByText(SEEDED[0].question)).toBeVisible();
    // The panel is a real modal: focus is inside it, not left on the ground.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector('[data-slot="sheet-content"]')
            ?.contains(document.activeElement),
        ),
      )
      .toBe(true);
  });

  test("closes on the X, on an outside press and on Escape", async ({
    page,
  }) => {
    const panel = sheet(page);

    await trigger(page).click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Cerrar historial" }).click();
    await expect(panel).toBeHidden();

    await trigger(page).click();
    await expect(panel).toBeVisible();
    // The panel is min(20rem, 85vw) ≈ 318px wide at 375px, so this lands on
    // the backdrop beside it.
    await page.mouse.click(360, 400);
    await expect(panel).toBeHidden();

    await trigger(page).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    // Base UI returns focus to the trigger — the phone-sized equivalent of
    // not stranding a keyboard user at the top of the document.
    await expect(trigger(page)).toBeFocused();
  });

  test("picking a question closes the sheet and renders the restored answer", async ({
    page,
  }) => {
    await trigger(page).click();
    await historyItem(page, SEEDED[0].question).click();

    await expect(sheet(page)).toBeHidden();
    await expect(
      page.getByRole("heading", { name: SEEDED[0].question }),
    ).toBeVisible();
    await expect(page.getByText(SEEDED[0].answer)).toBeVisible();

    // Nothing pushes the restored view wider than the phone (WCAG 1.4.10).
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // #138's `px-safe` regression guard: the utility is still applied and
    // still resolves to its design floor (`--safe-pad: 1.5rem` on this view).
    // The inset half of `max()` is 0 in headless Chromium — that is exactly
    // why this asserts the floor and calls itself a guard, not proof.
    const article = page.locator("article", {
      has: page.getByRole("heading", { name: SEEDED[0].question }),
    });
    expect(
      await article.evaluate((el) => getComputedStyle(el).paddingInlineStart),
    ).toBe("24px");
  });

  test("the ground behind the open sheet does not scroll", async ({ page }) => {
    // A restored answer long enough to overflow 667px of phone.
    await admin.from("questions").delete().eq("user_id", userId);
    const long = Array.from(
      { length: 40 },
      (_, i) => `Párrafo ${i + 1} de la respuesta guardada.`,
    ).join("\n\n");
    await seedQuestion("¿Qué plazos debo cumplir?", long, 5);
    await page.reload();

    await trigger(page).click();
    await historyItem(page, "¿Qué plazos debo cumplir?").click();
    await expect(sheet(page)).toBeHidden();

    // A CSS locator, not `getByRole`: an open modal marks the ground
    // `aria-hidden`, so the heading leaves the accessibility tree exactly when
    // this needs to measure it. And the ground's own offset is the observable,
    // not `scrollTop`: the lock pins the document, so `scrollTop` reads 0
    // while the sheet is open whether or not a wheel reached the page.
    const heading = page.locator("article h1");
    await expect(heading).toHaveText("¿Qué plazos debo cumplir?");
    const groundY = async () => (await heading.boundingBox())!.y;

    const atRest = await groundY();
    await page.mouse.move(190, 400);
    await page.mouse.wheel(0, 400);
    // Precondition: the ground genuinely scrolls, so the assertions below are
    // not vacuously true.
    await expect.poll(groundY).toBeLessThan(atRest);
    const scrolled = await groundY();

    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    // The pre-open offset is the baseline (#172): opening the sheet over a
    // scrolled ground must not move that ground. Until #172 this was measured
    // *after* opening, because opening snapped the ground back to the top.
    expect(await groundY()).toBeCloseTo(scrolled, 0);

    await page.mouse.move(360, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect(await groundY()).toBeCloseTo(scrolled, 0);

    // ...and dismissing puts the reader back exactly where they were (#172).
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect.poll(groundY).toBeCloseTo(scrolled, 0);
  });

  /**
   * The row's delete control is hover-revealed, and Tailwind's `hover:` only
   * fires under `@media (hover: hover)` — so on a phone it was invisible and
   * the question undeletable (found by the owner's iPhone pass for #138).
   * `hasTouch` makes Chromium report `(hover: none)`, the media state a phone
   * lives in; the precondition assertion keeps this from passing vacuously.
   */
  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true });

    test("the delete control is visible without hover and deletes on tap", async ({
      page,
    }) => {
      expect(
        await page.evaluate(() => matchMedia("(hover: none)").matches),
        "touch emulation must report (hover: none) or this proves nothing",
      ).toBe(true);

      await trigger(page).tap();
      const remove = sheet(page).getByRole("button", {
        name: `Eliminar: ${SEEDED[1].question}`,
      });
      await expect(remove).toBeVisible();
      // `toBeVisible` accepts opacity 0 — the computed value is the claim.
      expect(await remove.evaluate((el) => getComputedStyle(el).opacity)).toBe(
        "1",
      );

      await remove.tap();
      // The row leaves the list before its DELETE is sent, so a hidden row
      // proves only the optimistic half; reloading then can abort the request
      // and bring the row back. Wait for the server's answer first.
      const deleted = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response.url().includes("/api/history/"),
      );
      await sheet(page)
        .getByRole("button", { name: "Eliminar", exact: true })
        .tap();
      await expect(sheet(page).getByText(SEEDED[1].question)).toBeHidden();
      await expect(sheet(page).getByText(SEEDED[0].question)).toBeVisible();
      expect((await deleted).ok()).toBe(true);

      // Gone on the server too, not just optimistically.
      await page.reload();
      await trigger(page).tap();
      await expect(sheet(page).getByText(SEEDED[1].question)).toBeHidden();
    });
  });

  test("with a mouse the delete control stays hidden until the row is hovered", async ({
    page,
  }) => {
    // The other side of the media gate: the desktop reveal is still hover-only,
    // so the `no-hover:` fix did not simply turn the control on everywhere.
    expect(
      await page.evaluate(() => matchMedia("(hover: hover)").matches),
    ).toBe(true);
    await trigger(page).click();
    const remove = sheet(page).getByRole("button", {
      name: `Eliminar: ${SEEDED[1].question}`,
    });
    const opacity = () => remove.evaluate((el) => getComputedStyle(el).opacity);
    expect(await opacity()).toBe("0");
    await historyItem(page, SEEDED[1].question).hover();
    await expect.poll(opacity).toBe("1");
  });

  test("a finished ask reaches the top of the sheet without a reload", async ({
    page,
  }) => {
    await page.getByLabel("Su pregunta").fill(UNMATCHABLE_QUESTION);
    await page.getByRole("button", { name: "Enviar" }).click();
    // The honest fallback, streamed without a model call — the exchange is
    // finished, which is what triggers the shell's refetch.
    await expect(page.getByText(WEAK_ANSWER_TEXT)).toBeVisible();

    await trigger(page).click();
    // The refetch races the route's own write and retries up to three times
    // a second apart (history-shell.tsx), so give the ladder room to land.
    await expect(sheet(page).locator("li").first()).toContainText(
      UNMATCHABLE_QUESTION,
      { timeout: 15_000 },
    );
  });
});
