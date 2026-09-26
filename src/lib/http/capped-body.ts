/**
 * Reading a request body with a hard byte cap, for the routes that must not
 * hold whatever a caller chooses to send: `/api/csp-report` (#137) and
 * `/api/ask`. `request.json()` and `request.text()` read to the end before
 * anything can look at the size, so the cap is applied while reading.
 *
 * Two checks, because neither is enough alone. A declared `Content-Length`
 * over the cap is refused before a byte is read; a body that declares none
 * (chunked) or understates itself is counted as it streams, and the read
 * stops at the first chunk past the cap — the rest is never pulled.
 */

/** Distinguishes "the read failed" from "the body was too big" (`null`). */
export const UNREADABLE: unique symbol = Symbol("unreadable");

/**
 * Reads the body as UTF-8 text with a hard byte cap; null when there is more
 * than `maxBytes`. Rejects when the stream itself fails — a caller that needs
 * to tell that apart maps it onto `UNREADABLE`.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const stream = request.body;
  if (stream === null) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}
