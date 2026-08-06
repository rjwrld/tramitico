import type { Locator, Page } from "@playwright/test";

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
