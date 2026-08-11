/**
 * Identity-linking preconditions for issue #84 (decision 2): the same verified
 * email across magic link / Google / GitHub must resolve to one `user_id`.
 * The OAuth-side join is Supabase's automatic linking — it applies only when
 * BOTH sides are verified, and this project's side of that contract is what
 * this file pins:
 *
 *  1. The magic-link flow leaves the email VERIFIED (`email_confirmed_at`
 *     set on click) — an unverified email would never auto-link (Supabase's
 *     pre-account-takeover guard).
 *  2. Emails are unique in auth.users — a second account with the same
 *     address cannot be created, so the email side can never split.
 *
 * The Google leg itself is not exercisable locally: GoTrue verifies real
 * provider tokens against Google's JWKS, and the admin API has no endpoint
 * that fabricates an OAuth identity (checked against supabase-js 2.112's
 * auth.admin surface). Fabricating identity rows over SQL would only assert
 * state we wrote ourselves. Recorded in #84 alongside the decision.
 *
 * Env-gated like history.integration.test.ts: skipped wholesale unless
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "./database.types";

function loadDotEnvLocal() {
  const file = path.resolve(__dirname, "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnvLocal();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const hasDb = Boolean(url && serviceRoleKey && publishableKey);

vi.setConfig({ testTimeout: 30_000 });

type Client = SupabaseClient<Database>;

describe.skipIf(!hasDb)("identity linking preconditions (issue #84)", () => {
  let admin: Client;
  const email = `link-${randomUUID()}@example.com`;
  let userId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("magic-link click signs in AND verifies the email", async () => {
    // The real flow, minus SMTP: generateLink mints the same token_hash the
    // emailed link carries; verifyOtp is what /auth/confirm does with it.
    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError) throw new Error(linkError.message);
    userId = link.user.id;

    const client = createClient<Database>(url!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error: verifyError } = await client.auth.verifyOtp({
      type: "email",
      token_hash: link.properties.hashed_token,
    });
    expect(verifyError).toBeNull();
    expect(session.user?.id).toBe(userId);

    // The precondition automatic linking hinges on: the email identity is
    // verified, so a Google sign-in with this (provider-verified) address
    // links into this user instead of splitting.
    const { data: fetched, error: getError } =
      await admin.auth.admin.getUserById(userId);
    if (getError) throw new Error(getError.message);
    expect(fetched.user.email_confirmed_at).toBeTruthy();
  });

  it("a second account with the same email cannot be created", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `pw-${randomUUID()}`,
      email_confirm: true,
    });
    expect(data.user).toBeNull();
    expect(error?.code).toBe("email_exists");
  });
});
