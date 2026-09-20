import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

import { createServerClient } from "@supabase/ssr";
import { updateSession } from "./proxy";

/**
 * `@supabase/ssr` is replaced at the module boundary so `getClaims()` can be
 * made to throw the plain Error auth-js raises for a JWT header it cannot
 * verify (`Invalid alg claim`) — a shape the real library only produces from
 * a crafted cookie. The proxy runs on nearly every request, so this throw
 * escaping would turn a bad cookie into a 500 for whoever presents it.
 */
function mockGetClaims(impl: () => Promise<unknown>) {
  vi.mocked(createServerClient).mockReturnValue({
    auth: { getClaims: vi.fn(impl) },
  } as unknown as ReturnType<typeof createServerClient>);
}

describe("updateSession getClaims guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the pass-through response when getClaims throws", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    mockGetClaims(async () => {
      throw new Error("Invalid alg claim");
    });

    const response = await updateSession(
      new NextRequest("https://tramitico.com/historial", {
        headers: { cookie: "sb-test-ref-auth-token=base64-bm9wZQ" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still awaits a well-behaved getClaims", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const getClaims = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getClaims },
    } as unknown as ReturnType<typeof createServerClient>);

    await updateSession(new NextRequest("https://tramitico.com/"));
    expect(getClaims).toHaveBeenCalledTimes(1);
  });
});
