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

function legacy(report: Record<string, unknown>): NextRequest {
  return request(
    JSON.stringify({ "csp-report": report }),
    "application/csp-report",
  );
}

/** Every string the endpoint wrote, joined — what a log drain would see. */
function logged(): string {
  return vi.mocked(console.warn).mock.calls.flat().join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("logs an allowlisted subset of the legacy report-uri envelope", async () => {
    const response = await POST(
      legacy({
        "document-uri": "http://localhost:3000/preguntar?q=mi%20pregunta",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?token=abc",
        "script-sample": "alert(1)",
      }),
    );

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] violation — directive=script-src-elem " +
        "blocked=https://evil.example document=/preguntar",
    );
  });

  it("logs a Reporting API batch, camelCase field names and all", async () => {
    const batch = [
      {
        type: "csp-violation",
        body: {
          documentURL: "https://tramitico.com/historial",
          effectiveDirective: "img-src",
          blockedURL: "https://cdn.example/pixel.png",
        },
      },
    ];

    const response = await POST(
      request(JSON.stringify(batch), "application/reports+json"),
    );

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] violation — directive=img-src " +
        "blocked=https://cdn.example document=/historial",
    );
  });

  it("takes the directive name out of a whole violated-directive line", async () => {
    await POST(legacy({ "violated-directive": "script-src 'self' 'unsafe'" }));

    expect(logged()).toContain("directive=script-src ");
  });

  it("keeps the spec's non-URL blocked-uri keywords", async () => {
    await POST(
      legacy({ "effective-directive": "style-src", "blocked-uri": "inline" }),
    );

    expect(logged()).toContain("blocked=inline");
  });

  it("never lets an attacker's free text reach the log", async () => {
    const injection = "\n[csp-report] violation — directive=fake";
    await POST(
      legacy({
        "document-uri": `http://localhost:3000/${injection}`,
        "effective-directive": injection,
        "blocked-uri": injection,
        "original-policy": "¿cómo declaro el D-101?",
        extra: { nested: "PII: 1-2345-6789" },
      }),
    );

    const line = logged();
    expect(line).not.toContain("fake");
    expect(line).not.toContain("D-101");
    expect(line).not.toContain("1-2345-6789");
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("directive=redacted");
    expect(line).toContain("blocked=redacted");
    expect(line).toContain("document=redacted");
  });

  it("truncates a long document path rather than logging all of it", async () => {
    const path = `/${"a".repeat(400)}`;
    await POST(legacy({ "document-uri": `http://localhost:3000${path}` }));

    const line = logged();
    expect(line).toContain(`document=/${"a".repeat(119)}…`);
    expect(line.length).toBeLessThan(300);
  });

  it("drops an oversized body against the counter, unread", async () => {
    const body = JSON.stringify({
      "csp-report": { "document-uri": `http://x/${"a".repeat(9000)}` },
    });

    const response = await POST(request(body, "application/csp-report"));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] dropped — reason=oversized",
    );
    expect(logged()).not.toContain("aaa");
  });

  it("drops an oversized body a lying content-length understated", async () => {
    const req = request(
      JSON.stringify({ "csp-report": { "blocked-uri": "a".repeat(9000) } }),
      "application/csp-report",
    );
    req.headers.set("content-length", "12");

    await POST(req);

    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] dropped — reason=oversized",
    );
  });

  it("still answers 204 when the body is not JSON", async () => {
    const response = await POST(request("not json", "text/plain"));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] dropped — reason=unparsable",
    );
  });

  it("drops a well-formed JSON body that is not a report", async () => {
    await POST(
      request(JSON.stringify({ hello: "¿mi pregunta?" }), "application/json"),
    );

    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] dropped — reason=malformed",
    );
    expect(logged()).not.toContain("pregunta");
  });

  it("ignores a Reporting API entry that is not a CSP violation", async () => {
    const batch = [
      { type: "deprecation", body: { message: "¿mi pregunta?", id: "x" } },
    ];

    await POST(request(JSON.stringify(batch), "application/reports+json"));

    expect(console.warn).toHaveBeenCalledWith(
      "[csp-report] dropped — reason=malformed",
    );
    expect(logged()).not.toContain("pregunta");
  });

  it("logs at most one line per report in a batch, and caps the batch", async () => {
    const entry = {
      type: "csp-violation",
      body: { effectiveDirective: "img-src", documentURL: "https://x.test/" },
    };

    await POST(
      request(
        JSON.stringify(Array(50).fill(entry)),
        "application/reports+json",
      ),
    );

    expect(console.warn).toHaveBeenCalledTimes(10);
  });
});
