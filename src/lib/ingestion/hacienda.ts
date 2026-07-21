/**
 * hacienda.go.cr fetcher. The WAF fingerprints the TLS stack: plain fetch/curl
 * receives an HTTP 400 interstitial regardless of headers (ticket #3), while a
 * real browser network stack passes with zero cookies. So PDFs are fetched
 * through a Playwright browser context's request API.
 */
import { chromium } from "@playwright/test";

export async function fetchHaciendaPdf(url: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const response = await context.request.get(url);
    if (!response.ok()) {
      throw new Error(
        `Hacienda fetch failed: HTTP ${response.status()} for ${url}`,
      );
    }
    const body = await response.body();
    const head = body.subarray(0, 5).toString("latin1");
    if (!head.startsWith("%PDF")) {
      throw new Error(
        `Hacienda fetch for ${url}: response is not a PDF (WAF interstitial?)`,
      );
    }
    return body;
  } finally {
    await browser.close();
  }
}
