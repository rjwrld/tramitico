import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";

function mockExchange(error: { message: string } | null = null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function callbackRequest(headers: Record<string, string> = {}) {
  return new Request(
    "https://app.example/auth/callback?code=abc&next=/historial",
    {
      headers,
    },
  );
}

describe("auth callback host gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("redirects via x-forwarded-host when it matches the request host", async () => {
    mockExchange();
    const response = await GET(
      callbackRequest({ "x-forwarded-host": "app.example" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example/historial",
    );
  });

  it("falls back to same-origin when x-forwarded-host is foreign", async () => {
    mockExchange();
    const response = await GET(
      callbackRequest({ "x-forwarded-host": "evil.example" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example/historial",
    );
  });

  it("accepts the canonical host from NEXT_PUBLIC_SITE_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tramitico.com");
    mockExchange();
    const response = await GET(
      callbackRequest({ "x-forwarded-host": "tramitico.com" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://tramitico.com/historial",
    );
  });

  it("still rejects foreign hosts when NEXT_PUBLIC_SITE_URL is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tramitico.com");
    mockExchange();
    const response = await GET(
      callbackRequest({ "x-forwarded-host": "evil.example" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example/historial",
    );
  });

  it("redirects same-origin when the header is absent", async () => {
    mockExchange();
    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toBe(
      "https://app.example/historial",
    );
  });

  it("sends exchange failures to /auth/error", async () => {
    mockExchange({ message: "bad code" });
    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toBe(
      "https://app.example/auth/error",
    );
  });

  it("never emits an off-origin Location for a hostile next", async () => {
    mockExchange();
    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=abc&next=/%5Cevil.com",
        { headers: { "x-forwarded-host": "app.example" } },
      ),
    );
    expect(response.headers.get("location")).toBe("https://app.example/");
  });
});
