// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_COOKIE_NAME,
  FAKE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  fakeAuthFetch,
  fakeSession,
} from "@/lib/test-support/auth-session-fixture";
import { createClient } from "./client";

/**
 * The browser client writes the session through `document.cookie`, whose
 * attributes are invisible once stored (and jsdom's http origin would drop a
 * `Secure` cookie outright). Intercepting the setter captures the serialised
 * string the library hands the browser — attributes included.
 *
 * One production-mode case only: `createBrowserClient` memoises a singleton
 * per page, so a second client in this file would reuse the first's options.
 */
describe("browser createClient cookie attributes", () => {
  const writes: string[] = [];

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
    vi.stubGlobal("fetch", fakeAuthFetch());
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (value: string) => {
        writes.push(value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // Restore the prototype accessor.
    delete (document as unknown as { cookie?: unknown }).cookie;
    writes.length = 0;
  });

  it("marks the session cookie Secure in production", async () => {
    const supabase = createClient();
    const { access_token, refresh_token } = fakeSession(3600);

    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    await supabase.auth.stopAutoRefresh();

    expect(error).toBeNull();
    const header = writes.find((line) =>
      line.startsWith(`${AUTH_COOKIE_NAME}=`),
    );
    expect(header, "the session cookie is written").toBeDefined();
    expect(header).toMatch(/; Secure(;|$)/);
    expect(header).toMatch(/; Path=\//);
  });
});
