import { randomUUID } from "node:crypto";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/database.types";

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

/**
 * A question no chunk can match lexically, so retrieval is weak *whatever*
 * the corpus holds: `isWeak` is structural (no chunk surfaced by both legs),
 * and a lexeme absent from every chunk leaves the lexical leg empty. The
 * route then streams the honest fallback without calling the model — the ask
 * completes, persists, and costs nothing (see the ANTHROPIC_API_KEY note in
 * playwright.local.config.ts, which turns any *un*-weak ask into a loud
 * failure rather than a bill).
 */
const UNMATCHABLE_QUESTION = "¿Qué es zxqvlodrix?";
/** First words of WEAK_RETRIEVAL_ANSWER (src/lib/answer/prompt.ts). */
const WEAK_ANSWER_TEXT = "No encuentro base oficial";

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

/**
 * Whether an ask can complete on this database without a paid provider.
 *
 * The corpus is embedded at 1024 dimensions; the keyless stub embedder
 * produces 256, and `search_chunks` compares the two only when there are rows
 * to compare. So an empty stack (what CI's throwaway `supabase start` gives)
 * runs the ask keyless and end to end, while a corpus-carrying developer
 * database needs the real provider the corpus was embedded with.
 */
let corpusEmpty = false;
const usingStubEmbedder =
  (process.env.EMBEDDINGS_PROVIDER || "stub") === "stub";
const NO_ASK_REASON =
  "an ask cannot complete keyless here: this database carries an ingested " +
  "corpus (1024-dim embeddings) while EMBEDDINGS_PROVIDER is the 256-dim " +
  "stub, so search_chunks errors before anything is persisted. Re-run with " +
  "EMBEDDINGS_PROVIDER/VOYAGE_API_KEY set, or against an empty stack — " +
  "which is what CI does.";

test.beforeAll(async () => {
  const { count, error } = await admin
    .from("chunks")
    .select("*", { count: "exact", head: true });
  expect(error).toBeNull();
  corpusEmpty = (count ?? 0) === 0;
});

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
    // Precondition: the ground genuinely scrolls, so the assertion below is
    // not vacuously true.
    await expect.poll(groundY).toBeLessThan(atRest);

    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    // Measured *after* opening on purpose. Opening the sheet over a scrolled
    // ground currently snaps that ground back to the top and does not put it
    // back on close — a separate defect from the containment this test is
    // about, and one this spec deliberately does not paper over by asserting
    // the pre-open offset. See REPORT-161.md.
    const pinned = await groundY();

    await page.mouse.move(360, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    expect(await groundY()).toBeCloseTo(pinned, 0);
  });

  test("a finished ask reaches the top of the sheet without a reload", async ({
    page,
  }) => {
    if (!corpusEmpty && usingStubEmbedder) {
      // The repo's gate convention (#129): skip locally naming what is
      // missing, fail under CI rather than silently asserting nothing.
      expect(process.env.CI, NO_ASK_REASON).toBeFalsy();
      test.skip(true, NO_ASK_REASON);
    }

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
