import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/database.types";
import { WEAK_ANSWER_TEXT } from "./support";

/**
 * The institution-routed decline through the real /api/ask (#264). Runs in
 * the local lane (playwright.local.config.ts): keyless, so the route can only
 * take the weak-retrieval path, which is exactly the path the classifier
 * lives on.
 *
 * The question is built the way UNMATCHABLE_QUESTION is (support.ts): every
 * non-stop lexeme is absent from the corpus, so the lexical leg is empty on a
 * corpus-carrying developer database as much as on CI's empty one — «qué»
 * and «es» are Spanish stop words, «municipio» does not occur in any ingested
 * document (checked 2026-09-04: `municipal` does, `municipio` does not), and
 * the last word is nonsense. Structurally weak, whatever the stack holds —
 * and «municipio» is a keyword the classifier routes to the municipalidad.
 */
const MUNICIPAL_QUESTION = "¿Qué municipio es zxqvlodrix?";

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// The lane pins one anonymous ask per day (RATE_LIMIT_ANON=1) and a decline
// consumes it, so each test starts from a clean counter — same reset as
// rate-limit.local.spec.ts, for the same reason.
test.beforeEach(async () => {
  const { error } = await admin
    .from("rate_limits")
    .delete()
    .like("subject", "anon:%");
  expect(error).toBeNull();
});

test("a municipal question gets the decline routed to the municipalidad", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Su pregunta").fill(MUNICIPAL_QUESTION);
  await page.getByRole("button", { name: "Enviar" }).click();

  // The decline: the shared opening, the out-of-scope line naming the
  // institution, and the link row built from the routing table.
  await expect(page.getByText(WEAK_ANSWER_TEXT)).toBeVisible();
  await expect(page.getByText(/fuera de lo que cubro/)).toBeVisible();
  await expect(
    page.getByText(/corresponder a la municipalidad de su cantón/),
  ).toBeVisible();
  const link = page.getByRole("link", {
    name: "la municipalidad de su cantón",
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://www.ifam.go.cr");
  // Not the general decline: neither in-scope portal is offered.
  await expect(page.getByText("hacienda.go.cr")).toHaveCount(0);
});

test("the wire carries the routing category ahead of the decline text", async ({
  request,
}) => {
  const response = await request.post("/api/ask", {
    data: { question: MUNICIPAL_QUESTION },
  });
  expect(response.status()).toBe(200);
  const body = await response.text();

  const routedAt = body.indexOf('"type":"data-routed"');
  const textAt = body.indexOf('"type":"text-start"');
  expect(routedAt).toBeGreaterThanOrEqual(0);
  expect(routedAt).toBeLessThan(textAt);
  expect(body).toContain('"category":"municipal"');
  expect(body).not.toContain('"type":"data-citations"');
});
