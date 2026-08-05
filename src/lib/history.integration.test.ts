/**
 * RLS proof for per-user history (issue #23): user A cannot read or delete
 * user B's questions, and inserts always land under the session's own id.
 *
 * Env-gated: skipped wholesale unless SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set (all three come from
 * `supabase status -o env` / .env.local), so CI stays green without a database.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "./database.types";
import {
  deleteQuestion,
  listQuestions,
  saveQuestion,
  sessionUserId,
} from "./history";

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
): Promise<{ client: Client; id: string }> {
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
  return { client, id: created.user.id };
}

describe.skipIf(!hasDb)("questions RLS (issue #23)", () => {
  let admin: Client;
  let userA: { client: Client; id: string };
  let userB: { client: Client; id: string };
  let savedId: string;

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    userA = await signedInUser(admin, `rls-a-${randomUUID()}@example.com`);
    userB = await signedInUser(admin, `rls-b-${randomUUID()}@example.com`);

    const result = await saveQuestion(userA.client, {
      question: "¿Debo facturar electrónicamente?",
      answer: "Sí, según el artículo…",
      citations: [{ label: "Ley 9635 art. 4" }],
    });
    if (!result.saved) throw new Error(`seed insert failed: ${result.reason}`);
    savedId = result.id;
  });

  afterAll(async () => {
    // Cascade removes each user's questions.
    if (userA) await admin.auth.admin.deleteUser(userA.id);
    if (userB) await admin.auth.admin.deleteUser(userB.id);
  });

  it("saves under the session's own user id", async () => {
    expect(await sessionUserId(userA.client)).toBe(userA.id);
    const rows = await listQuestions(userA.client);
    expect(rows.map((r) => r.id)).toContain(savedId);
    expect(rows.every((r) => r.user_id === userA.id)).toBe(true);
  });

  it("user B cannot read user A's questions", async () => {
    expect(await listQuestions(userB.client)).toEqual([]);
  });

  it("user B cannot delete user A's question", async () => {
    await deleteQuestion(userB.client, savedId);
    const stillThere = await listQuestions(userA.client);
    expect(stillThere.map((r) => r.id)).toContain(savedId);
  });

  it("user B cannot forge a row under user A's id", async () => {
    const { error } = await userB.client.from("questions").insert({
      user_id: userA.id,
      question: "forjada",
      answer: "forjada",
    });
    expect(error).not.toBeNull();
  });

  it("anonymous sessions cannot save and read nothing", async () => {
    const anon = anonClient();
    await expect(
      saveQuestion(anon, { question: "q", answer: "a", citations: [] }),
    ).resolves.toEqual({ saved: false, reason: "anonymous" });
    expect(await listQuestions(anon)).toEqual([]);
  });
});
