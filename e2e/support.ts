import { type Locator, type Page } from "@playwright/test";

/**
 * Shared /api/ask stubbing for specs that exercise client behavior against a
 * controlled stream (wire shape per src/lib/answer/contract.ts). Specs that
 * own the unstubbed pass (chat-flow.spec.ts) hit the real route instead.
 */
export const CITATION = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=88953&param2=&param3=1&param4=",
  // Read on the Costa Rica calendar by the chip's caption (#135).
  fetchedAt: "2026-08-06T15:04:05Z",
};

/** Next.js's route announcer is also role=alert — filter to ours. */
export function inlineAlert(page: Page, text: string): Locator {
  return page.getByRole("alert").filter({ hasText: text });
}

export function sse(chunks: object[]): string {
  return (
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

/** A minimal happy-path stream: two text deltas with one citation between. */
export function answerStream(
  firstDelta: string,
  secondDelta: string,
  citations: object[] = [CITATION],
): string {
  return sse([
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: firstDelta },
    { type: "data-citations", id: "citations", data: citations },
    { type: "text-delta", id: "t1", delta: secondDelta },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ]);
}

export async function stubAsk(
  page: Page,
  body: string,
  { status = 200, delayMs = 0 }: { status?: number; delayMs?: number } = {},
): Promise<void> {
  await page.route("**/api/ask", async (route) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status,
      headers:
        status === 200
          ? {
              "content-type": "text/event-stream",
              "x-vercel-ai-ui-message-stream": "v1",
            }
          : { "content-type": "application/json" },
      body,
    });
  });
}

/**
 * A question no chunk can match lexically, so retrieval is weak *whatever*
 * the corpus holds: `isWeak` is structural (no chunk surfaced by both legs),
 * and a lexeme absent from every chunk leaves the lexical leg empty. The
 * route then streams the honest fallback without calling the model — the ask
 * completes, consumes the caller's quota, costs nothing, and (for a signed-in
 * caller only — `route.ts` saves `if (userId)`) persists (see
 * the ANTHROPIC_API_KEY note in playwright.local.config.ts, which turns any
 * *un*-weak ask into a loud failure rather than a bill).
 *
 * "Consumes the quota" is the half rate-limit.local.spec.ts leans on (#173):
 * an honest decline is a delivered answer, so it does not refund (#126),
 * while a `retrieval_failed`/`answer_failed` ask hands the slot back and
 * leaves the counter where it started.
 */
export const UNMATCHABLE_QUESTION = "¿Qué es zxqvlodrix?";

/** First words of WEAK_RETRIEVAL_ANSWER (src/lib/answer/prompt.ts). */
export const WEAK_ANSWER_TEXT = "No encuentro base oficial";
