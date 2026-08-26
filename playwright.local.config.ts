import { defineConfig } from "@playwright/test";

/**
 * Opt-in e2e config for specs that need a real local Supabase in the loop
 * (issue #47). The default config (playwright.config.ts) pins the server-side
 * Supabase env empty so the rate limiter deterministically fails closed; this
 * one passes the real env through and pins RATE_LIMIT_ANON=1 so a second
 * anonymous ask genuinely exceeds the fixed-window counter — a real 429, not
 * the fail-closed 503. Run it with:
 *
 *   supabase start
 *   eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)')"
 *   SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
 *     pnpm test:e2e:local
 */

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error(
    "test:e2e:local needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
      "pointed at a running local Supabase (`supabase status -o env`).",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.local.spec.ts",
  // Every anonymous subject shares the rate_limits table and specs reset it —
  // run serially so they stay off each other's counters.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    // Own port so a fail-closed server from the default config on :3000 is
    // never reused with the wrong env.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        "sb_publishable_placeholder",
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      // One anonymous question per day: the second ask is the real 429.
      RATE_LIMIT_ANON: "1",
      // Required to derive the anonymous subject at all (#125) — without it
      // both asks would fail closed with a 503 and never reach the counter.
      RATE_LIMIT_SUBJECT_SECRET: "e2e-local-subject-secret",
      // Asks in this lane must terminate keyless and cost-free: the stub
      // embedder keeps the embedder local, and an empty Anthropic key makes
      // any model call fail fast instead of spending tokens. That empty key
      // is a cost guard, not a stub — the specs lean on it: every ask in
      // this lane is deliberately unmatchable (UNMATCHABLE_QUESTION in
      // e2e/support.ts), so the route takes the weak-retrieval path and never
      // calls the model; an ask that somehow *did* retrieve would fail loudly
      // here rather than bill anyone. That also keeps the asks off the refund
      // path (#173): a decline is delivered, so it consumes the quota, which
      // is what rate-limit.local.spec.ts needs to reach a real 429.
      //
      // Since #193 the stub emits vectors of the schema's own width, so this
      // lane runs keyless against *any* stack — CI's empty throwaway one and
      // a developer database carrying the ingested corpus alike. The stub's
      // vector leg is meaningless against a real corpus, which costs these
      // specs nothing: every ask here is unmatchable, and that weakness is
      // structural (no chunk in both legs), not a matter of what the vector
      // leg returns.
      EMBEDDINGS_PROVIDER: process.env.EMBEDDINGS_PROVIDER || "stub",
      VOYAGE_API_KEY: process.env.VOYAGE_API_KEY ?? "",
      ANTHROPIC_API_KEY: "",
      RERANK: "off",
    },
  },
});
