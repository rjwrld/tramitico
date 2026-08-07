import { describe, expect, it } from "vitest";

import {
  deleteQuestion,
  listQuestions,
  sessionUserId,
  type HistoryClient,
  type QuestionRow,
} from "./history";

type Row = QuestionRow;

const row = (over: Partial<Row> = {}): Row => ({
  id: "q-1",
  user_id: "user-a",
  question: "¿Debo facturar electrónicamente?",
  answer: "Sí, según…",
  citations: [],
  created_at: "2026-08-01T12:00:00Z",
  ...over,
});

// Structural fake for the narrow slice of SupabaseClient that history.ts uses.
function fakeClient(opts: {
  userId?: string | null;
  rows?: Row[];
  selectError?: { message: string } | null;
  deleteError?: { message: string } | null;
  calls?: Record<string, unknown>[];
}): HistoryClient {
  const calls = opts.calls ?? [];
  return {
    auth: {
      getClaims: async () =>
        opts.userId
          ? { data: { claims: { sub: opts.userId } }, error: null }
          : { data: null, error: null },
    },
    from: () => ({
      select: () => ({
        order: (column, orderOpts) => {
          calls.push({ op: "order", column, ...orderOpts });
          return Promise.resolve(
            opts.selectError
              ? { data: null, error: opts.selectError }
              : { data: opts.rows ?? [], error: null },
          );
        },
      }),
      delete: () => ({
        eq: (column, value) => {
          calls.push({ op: "delete", column, value });
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      }),
    }),
  };
}

describe("sessionUserId", () => {
  it("returns the subject claim for a signed-in session", async () => {
    expect(await sessionUserId(fakeClient({ userId: "user-a" }))).toBe(
      "user-a",
    );
  });

  it("returns null when there is no session", async () => {
    expect(await sessionUserId(fakeClient({ userId: null }))).toBeNull();
  });
});

describe("listQuestions", () => {
  it("returns rows newest first", async () => {
    const calls: Record<string, unknown>[] = [];
    const rows = [row({ id: "q-2" }), row({ id: "q-1" })];
    await expect(
      listQuestions(fakeClient({ userId: "user-a", rows, calls })),
    ).resolves.toEqual(rows);
    expect(calls).toEqual([
      { op: "order", column: "created_at", ascending: false },
    ]);
  });

  it("throws on a database error", async () => {
    await expect(
      listQuestions(fakeClient({ selectError: { message: "boom" } })),
    ).rejects.toThrow(/boom/);
  });
});

describe("deleteQuestion", () => {
  it("deletes by id and relies on RLS for ownership", async () => {
    const calls: Record<string, unknown>[] = [];
    await deleteQuestion(fakeClient({ userId: "user-a", calls }), "q-9");
    expect(calls).toEqual([{ op: "delete", column: "id", value: "q-9" }]);
  });

  it("throws on a database error", async () => {
    await expect(
      deleteQuestion(fakeClient({ deleteError: { message: "boom" } }), "q-9"),
    ).rejects.toThrow(/boom/);
  });
});
