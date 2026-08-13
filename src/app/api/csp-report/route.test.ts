import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { POST } from "./route";

function request(body: string, contentType: string): NextRequest {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  }) as NextRequest;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("logs the legacy report-uri envelope and answers 204", async () => {
    const report = {
      "csp-report": {
        "document-uri": "http://localhost:3000/",
        "violated-directive": "script-src",
      },
    };

    const response = await POST(
      request(JSON.stringify(report), "application/csp-report"),
    );

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report]",
      JSON.stringify(report),
    );
  });

  it("logs a Reporting API batch", async () => {
    const batch = [{ type: "csp-violation", body: { disposition: "report" } }];

    const response = await POST(
      request(JSON.stringify(batch), "application/reports+json"),
    );

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report]",
      JSON.stringify(batch),
    );
  });

  it("still answers 204 when the body is not JSON", async () => {
    const response = await POST(request("not json", "text/plain"));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] unparsable report body",
    );
  });
});
