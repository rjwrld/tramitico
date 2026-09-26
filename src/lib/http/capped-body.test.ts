import { describe, expect, it } from "vitest";

import { readCappedBody } from "./capped-body";

function request(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

/**
 * A chunked body with no Content-Length: `chunks` byte arrays, then either
 * the end or, when `forever`, one more `filler` chunk per pull. Counts pulls
 * and records a cancel, so a test can see where the reader stopped.
 */
function streamed(
  chunks: Uint8Array[],
  options: { forever?: boolean; filler?: Uint8Array } = {},
) {
  const seen = { pulls: 0, cancelled: false };
  const queue = [...chunks];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else if (options.forever && options.filler) {
        controller.enqueue(options.filler);
      } else controller.close();
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe("readCappedBody", () => {
  it("returns a body within the cap as text", async () => {
    await expect(
      readCappedBody(request('{"question":"¿IVA?"}'), 64),
    ).resolves.toBe('{"question":"¿IVA?"}');
  });

  it("counts bytes, not characters, and allows a body exactly at the cap", async () => {
    // "á" is two bytes: 4 characters, 8 bytes.
    await expect(readCappedBody(request("áááá"), 8)).resolves.toBe("áááá");
    await expect(readCappedBody(request("ááááa"), 8)).resolves.toBeNull();
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const req = request("{}", { "content-length": "65" });

    await expect(readCappedBody(req, 64)).resolves.toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it("stops reading a chunked body at the first chunk past the cap", async () => {
    const kib = new Uint8Array(1024).fill(0x20);
    const { stream, seen } = streamed([], { forever: true, filler: kib });

    await expect(readCappedBody(request(stream), 4 * 1024)).resolves.toBeNull();
    // Five chunks put it past 4 KiB; the stream may be one pull ahead of the
    // reader, and never more.
    expect(seen.pulls).toBeLessThanOrEqual(6);
    expect(seen.cancelled).toBe(true);
  });

  it("refuses a body a Content-Length understated", async () => {
    const { stream } = streamed([new Uint8Array(100).fill(0x20)]);

    await expect(
      readCappedBody(request(stream, { "content-length": "2" }), 64),
    ).resolves.toBeNull();
  });

  it("decodes a character split across two chunks", async () => {
    const [lead, trail] = new TextEncoder().encode("á");
    const { stream } = streamed([
      new Uint8Array([0x22, lead]),
      new Uint8Array([trail, 0x22]),
    ]);

    await expect(readCappedBody(request(stream), 64)).resolves.toBe('"á"');
  });

  it("reads a request with no body as empty", async () => {
    await expect(readCappedBody(request(null), 64)).resolves.toBe("");
  });

  it("rejects when the stream itself fails", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket closed"));
      },
    });

    await expect(readCappedBody(request(stream), 64)).rejects.toThrow(
      "socket closed",
    );
  });
});
