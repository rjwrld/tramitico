/**
 * Least-privilege proof for per-user history (issues #23, #123).
 *
 * Two claims, in order of which lock fails first:
 *  1. Grants: `anon` and `authenticated` hold no privileges on `public`, so a
 *     browser client cannot read, insert or delete `questions` — or read
 *     `chunks` — at all. This is the outer lock; the RLS policies on
 *     `questions` survive underneath as defense in depth but are unreachable.
 *  2. Scoping: the service-role path the API routes actually use bypasses RLS,
 *     so `listQuestions`/`deleteQuestion`'s `user_id` filter is what isolates
 *     one user's history from another's.
 *
 * Env-gated: skipped locally unless SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set (all three come from
 * `supabase status -o env` / .env.local); on CI a missing one fails the
 * integration job rather than skipping (#129).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { Database } from "./database.types";
import { envPrereqs, integrationSuite } from "./test-support/suite-gate";
import { asQuestionsClient, saveQuestion } from "./answer/persist";
import {
  asHistoryClient,
  deleteQuestion,
  listQuestions,
  sessionUserId,
} from "./history";
import { parseCitations, type Citation } from "./retrieval";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const describeDb = integrationSuite(
  envPrereqs(
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ),
);

vi.setConfig({ testTimeout: 30_000 });

type Client = SupabaseClient<Database>;

// Postgres's insufficient_privilege. Asserting the code, not just "some
// error", is the point: an RLS refusal returns an empty set or 42501-free
// policy violation, a missing grant returns exactly this.
const INSUFFICIENT_PRIVILEGE = "42501";

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

describeDb("questions least privilege (issues #23, #123)", () => {
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

    // Seed through the service role — the only write path there is now, and
    // the same one persist.ts uses in production.
    const { data, error } = await admin
      .from("questions")
      .insert({
        user_id: userA.id,
        question: "¿Debo facturar electrónicamente?",
        answer: "Sí, según el artículo…",
        citations: [{ label: "Ley 9635 art. 4" }],
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`seed insert failed: ${error?.message ?? "no row"}`);
    }
    savedId = data.id;
  });

  afterAll(async () => {
    // Cascade removes each user's questions.
    if (userA) await admin.auth.admin.deleteUser(userA.id);
    if (userB) await admin.auth.admin.deleteUser(userB.id);
  });

  it("still reads the session's id from the cookie-scoped client", async () => {
    expect(await sessionUserId(userA.client)).toBe(userA.id);
  });

  it("lists only the requested owner's rows under the service role", async () => {
    const rows = await listQuestions(asHistoryClient(admin), userA.id);
    expect(rows.map((r) => r.id)).toContain(savedId);
    expect(rows.every((r) => r.user_id === userA.id)).toBe(true);
    expect(await listQuestions(asHistoryClient(admin), userB.id)).toEqual([]);
  });

  it("does not delete a row whose owner does not match", async () => {
    await deleteQuestion(asHistoryClient(admin), savedId, userB.id);
    const stillThere = await listQuestions(asHistoryClient(admin), userA.id);
    expect(stillThere.map((r) => r.id)).toContain(savedId);
  });

  it("denies a signed-in browser client every operation on questions", async () => {
    const { error: selectError } = await userA.client
      .from("questions")
      .select("*");
    expect(selectError?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const { error: insertError } = await userA.client
      .from("questions")
      .insert({ user_id: userA.id, question: "q", answer: "a" });
    expect(insertError?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const { error: deleteError } = await userA.client
      .from("questions")
      .delete()
      .eq("id", savedId);
    expect(deleteError?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("denies an anonymous client every operation on questions", async () => {
    const anon = anonClient();

    const { error: selectError } = await anon.from("questions").select("*");
    expect(selectError?.code).toBe(INSUFFICIENT_PRIVILEGE);

    const { error: insertError } = await anon
      .from("questions")
      .insert({ user_id: userA.id, question: "q", answer: "a" });
    expect(insertError?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("denies both roles any read of the corpus tables", async () => {
    for (const client of [anonClient(), userA.client]) {
      const { error: chunksError } = await client.from("chunks").select("id");
      expect(chunksError?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const { error: documentsError } = await client
        .from("documents")
        .select("id");
      expect(documentsError?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("denies both roles the service-role RPCs", async () => {
    for (const client of [anonClient(), userA.client]) {
      const { error } = await client.rpc("rate_limit_increment", {
        p_subject: "probe",
        p_window_start: new Date(0).toISOString(),
        p_cutoff: new Date(0).toISOString(),
      });
      expect(error).not.toBeNull();
    }
  });
});

describeDb("questions.citations round-trip (issue #61)", () => {
  let admin: Client;
  let user: { client: Client; id: string };

  const CITATIONS: Citation[] = [
    {
      docKey: "ley-9635",
      docTitle: "Ley de Fortalecimiento de las Finanzas Públicas",
      norma: "Ley 9635",
      articulo: "ARTÍCULO 4",
      url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=87587&param2=&param3=1&param4=",
    },
    // A chunk cited at the norma level, with no específico artículo — the
    // null case #61 asks the round-trip to cover.
    {
      docKey: "ley-cabys",
      docTitle: "Catálogo de Bienes y Servicios",
      norma: null,
      articulo: null,
      url: null,
    },
  ];

  beforeAll(async () => {
    admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    user = await signedInUser(admin, `citations-${randomUUID()}@example.com`);
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("re-parses as Citation[] after a saveQuestion / listQuestions round-trip", async () => {
    await saveQuestion(
      {
        userId: user.id,
        question: "¿Debo inscribirme en el régimen simplificado?",
        answer: "No, según la Ley 9635…",
        citations: CITATIONS,
      },
      asQuestionsClient(admin),
    );

    const rows = await listQuestions(asHistoryClient(admin), user.id);
    expect(rows).toHaveLength(1);
    expect(parseCitations(rows[0].citations)).toEqual(CITATIONS);
  });
});
