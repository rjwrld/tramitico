import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // *.local.spec.ts need a live local Supabase — playwright.local.config.ts
  // owns those (pnpm test:e2e:local, issue #47).
  testIgnore: "**/*.local.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The anonymous smoke never dials Supabase (no session cookies → no
    // network), but the SSR clients need *some* URL/key to construct. Real
    // values win when present; placeholders keep CI green without a database.
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        "sb_publishable_placeholder",
      // Server-side Supabase is pinned empty so the rate limiter fails closed
      // deterministically — chat-flow.spec.ts drives the real /api/ask through
      // that path everywhere, never a real database or model.
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
});
