/**
 * Cascade proof for self-service account deletion (issue #86): deleting the
 * auth user with the service-role client — the same call
 * `POST /api/account/delete` makes — removes every trace of that user's
 * history, and never touches another user's rows.
 *
 * Env-gated like history.integration.test.ts: skipped wholesale unless
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set (all three come from
 * `supabase status -o env` / .env.local), so CI stays green without a
 * database.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "./database.types";
import { listQuestions } from "./history";

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

const PASSWORD = `pw-${randomUUID()}`;

function anonClient(): Client {
  return createClient<Database>(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInUser(
  admin: Client,
  email: string,
): Promise<{ client: Client; id: string; email: string }> {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
  if (createError) throw new Error(createError.message);
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw new Error(signInError.message);
  return { client, id: created.user.id, email };
}

describe.skipIf(!hasDb)("account deletion cascade (issue #86)", () => {
  let admin: Client;
  let userA: { client: Client; id: string; email: string };
  let userB: { client: Client; id: string; email: string };

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    userA = await signedInUser(admin, `del-a-${randomUUID()}@example.com`);
    userB = await signedInUser(admin, `del-b-${randomUUID()}@example.com`);

    // Seed both users with history through the RLS "insert own rows" path.
    for (const [user, label] of [
      [userA, "A"],
      [userB, "B"],
    ] as const) {
      const { error } = await user.client.from("questions").insert({
        user_id: user.id,
        question: `¿Pregunta de ${label}?`,
        answer: `Respuesta de ${label}.`,
        citations: [{ label: "Ley 9635 art. 4" }],
      });
      if (error) throw new Error(`seed insert failed: ${error.message}`);
    }
  });

  afterAll(async () => {
    // userA is deleted by the test itself; only clean up userB.
    if (userB) await admin.auth.admin.deleteUser(userB.id);
  });

  it("deletes the auth user and cascades their questions, leaving user B untouched", async () => {
    expect(await listQuestions(userA.client)).toHaveLength(1);
    expect(await listQuestions(userB.client)).toHaveLength(1);

    // Same call POST /api/account/delete makes.
    const { error } = await admin.auth.admin.deleteUser(userA.id);
    expect(error).toBeNull();

    // The auth user is gone: signing in again fails.
    const reSignIn = await anonClient().auth.signInWithPassword({
      email: userA.email,
      password: PASSWORD,
    });
    expect(reSignIn.error).not.toBeNull();

    // Cascade removed A's history, reachable only via service role now that
    // A's session is gone.
    const { data: remainingForA, error: selectError } = await admin
      .from("questions")
      .select("id")
      .eq("user_id", userA.id);
    expect(selectError).toBeNull();
    expect(remainingForA).toEqual([]);

    // User B's account and history are untouched.
    expect(await listQuestions(userB.client)).toHaveLength(1);
  });
});

/**
 * Session-revocation proof for the delete route (issue #124), against the same
 * GoTrue the route talks to. Pins the two facts the route's ordering and its
 * `getUser()` choice rest on, plus the accepted risk recorded on #121.
 */
describe.skipIf(!hasDb)("deleted-account sessions (issue #124)", () => {
  let admin: Client;

  beforeAll(() => {
    admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  async function freshSession() {
    const user = await signedInUser(admin, `so-${randomUUID()}@example.com`);
    const { data } = await user.client.auth.getSession();
    if (!data.session) throw new Error("expected a session after sign-in");
    return { id: user.id, session: data.session };
  }

  it("kills every refresh token: after global sign-out + delete, no new session can be minted", async () => {
    const { id, session } = await freshSession();

    // The route's sequence, in the route's order.
    const signOut = await admin.auth.admin.signOut(
      session.access_token,
      "global",
    );
    expect(signOut.error).toBeNull();
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();

    const refreshed = await anonClient().auth.refreshSession({
      refresh_token: session.refresh_token,
    });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
  });

  it("rejects the sign-out if it runs after the delete — why the route signs out first", async () => {
    const { id, session } = await freshSession();

    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();

    const signOut = await admin.auth.admin.signOut(
      session.access_token,
      "global",
    );
    expect(signOut.error?.message).toMatch(/does not exist/);
  });

  it("getUser rejects a deleted user's access token while getClaims still accepts it", async () => {
    const { id, session } = await freshSession();
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();

    // Why the delete route uses getUser(): it is the only one of the two that
    // refuses a token whose user is gone, so a request bearing an
    // already-deleted user's token cannot reach the admin delete again.
    const verified = await anonClient().auth.getUser(session.access_token);
    expect(verified.error).not.toBeNull();
    expect(verified.data.user).toBeNull();

    // The accepted risk on #121, asserted rather than assumed: under
    // asymmetric signing keys getClaims verifies locally, so read paths keep
    // honouring the token until it expires (≤1h).
    const local = await anonClient().auth.getClaims(session.access_token);
    expect(local.error).toBeNull();
    expect(local.data?.claims.sub).toBe(id);
    expect(local.data?.header.alg).toMatch(/^(ES|RS)/);
  });
});
