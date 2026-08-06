import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/database.types";
import { inlineAlert } from "./support";

/**
 * Real 429 through /api/ask with a local Supabase in the loop (issue #47,
 * SPEC §7). Runs only via playwright.local.config.ts, which starts the server
 * with the real local Supabase env and RATE_LIMIT_ANON=1: the first anonymous
 * ask consumes the day's single question, the second genuinely exceeds the
 * fixed-window counter. #27's default e2e run can only reach the fail-closed
 * 503; this is the only place the rate_limited branch runs unstubbed.
 */

const NUDGE = "Alcanzó el límite de 1 preguntas gratis por hoy";
/** es-CR reset time, e.g. "después de las 6:00 p. m." */
const RESET_TIME = /después de las \d{1,2}:\d{2}/;

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Counters persist across runs (fixed daily window), so each test starts from
// a clean slate for every anonymous subject.
test.beforeEach(async () => {
  const { error } = await admin
    .from("rate_limits")
    .delete()
    .like("subject", "anon:%");
  expect(error).toBeNull();
});

test("the second anonymous ask renders the real 429 copy inline", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Su pregunta");
  const enviar = page.getByRole("button", { name: "Enviar" });

  // First ask: allowed (1 of 1). Its answer doesn't matter — only that the
  // limiter counted it and the exchange settles so a second ask can go out.
  await input.fill("¿Cuánto es el IVA?");
  const firstResponse = page.waitForResponse("**/api/ask");
  await enviar.click();
  expect((await firstResponse).status()).not.toBe(429);

  await input.fill("¿Y la factura electrónica?");
  await expect(enviar).toBeEnabled();
  await enviar.click();

  // Second ask: the real fixed-window 429, rendered inline with the limit,
  // the sign-in nudge, and the reset time (SPEC §7 copy from #24).
  const alert = inlineAlert(page, NUDGE);
  await expect(alert).toContainText(
    "Inicie sesión para tener 50 preguntas diarias",
  );
  await expect(alert).toContainText(RESET_TIME);
});

test("the 429 body carries the { error, message } contract", async ({
  request,
}) => {
  const question = { data: { question: "¿Cuánto es el IVA?" } };

  const first = await request.post("/api/ask", question);
  expect(first.status()).not.toBe(429);

  const second = await request.post("/api/ask", question);
  expect(second.status()).toBe(429);
  const body = (await second.json()) as { error: string; message: string };
  expect(body.error).toBe("rate_limited");
  expect(body.message).toContain(NUDGE);
  expect(body.message).toMatch(RESET_TIME);
});
