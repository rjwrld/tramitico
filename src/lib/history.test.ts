import { describe, expect, it } from "vitest";

import {
  deleteQuestion,
  listQuestions,
  sessionUserId,
  type HistoryClient,
  type QuestionRow,
  type SessionClient,
} from "./history";

type Row = QuestionRow;

const row = (over: Partial<Row> = {}): Row => ({
  id: "q-1",
  user_id: "user-a",
  question: "¿Debo facturar electrónicamente?",
  answer: "Sí, según…",
  citations: [],
  condensed_question: null,
  created_at: "2026-08-01T12:00:00Z",
  ...over,
});

function fakeSession(userId: string | null): SessionClient {
  return {
    auth: {
      getClaims: async () =>
        userId
          ? { data: { claims: { sub: userId } }, error: null }
          : { data: null, error: null },
    },
  };
}

// Structural fake for the narrow slice of SupabaseClient that history.ts uses.
// It records every filter, because under the service role those filters are
// the whole of the per-user isolation (issue #123).
function fakeClient(opts: {
  rows?: Row[];
  selectError?: { message: string } | null;
  deleteError?: { message: string } | null;
  calls?: Record<string, unknown>[];
}): HistoryClient {
  const calls = opts.calls ?? [];
  return {
    from: () => ({
      select: () => ({
        eq: (column, value) => {
          calls.push({ op: "select", column, value });
          return {
            order: (orderColumn, orderOpts) => {
              calls.push({ op: "order", column: orderColumn, ...orderOpts });
              return Promise.resolve(
                opts.selectError
                  ? { data: null, error: opts.selectError }
                  : { data: opts.rows ?? [], error: null },
              );
            },
          };
        },
      }),
      delete: () => ({
        eq: (column, value) => {
          calls.push({ op: "delete", column, value });
          return {
            eq: (ownerColumn, ownerValue) => {
              calls.push({
                op: "delete",
                column: ownerColumn,
                value: ownerValue,
              });
              return Promise.resolve({ error: opts.deleteError ?? null });
            },
          };
        },
      }),
    }),
  };
}

describe("sessionUserId", () => {
  it("returns the subject claim for a signed-in session", async () => {
    expect(await sessionUserId(fakeSession("user-a"))).toBe("user-a");
  });

  it("returns null when there is no session", async () => {
    expect(await sessionUserId(fakeSession(null))).toBeNull();
  });

  it("returns null when getClaims throws on a malformed cookie", async () => {
    const throwing: SessionClient = {
      auth: {
        getClaims: async () => {
          throw new Error("Invalid alg claim");
        },
      },
    };
    expect(await sessionUserId(throwing)).toBeNull();
  });
});

describe("listQuestions", () => {
  it("returns the owner's rows newest first", async () => {
    const calls: Record<string, unknown>[] = [];
    const rows = [row({ id: "q-2" }), row({ id: "q-1" })];
    await expect(
      listQuestions(fakeClient({ rows, calls }), "user-a"),
    ).resolves.toEqual(rows);
    expect(calls).toEqual([
      { op: "select", column: "user_id", value: "user-a" },
      { op: "order", column: "created_at", ascending: false },
    ]);
  });

  // #136: the rejection names the operation, never the driver's message —
  // PostgREST quotes the offending row, and on `questions` that row holds
  // somebody's question.
  it("throws on a database error, without the driver's message", async () => {
    const failing = fakeClient({ selectError: { message: "boom" } });
    await expect(listQuestions(failing, "user-a")).rejects.toThrow(
      /history list failed/,
    );
    await expect(listQuestions(failing, "user-a")).rejects.not.toThrow(/boom/);
  });
});

describe("deleteQuestion", () => {
  it("filters on both the row id and its owner", async () => {
    const calls: Record<string, unknown>[] = [];
    await deleteQuestion(fakeClient({ calls }), "q-9", "user-a");
    expect(calls).toEqual([
      { op: "delete", column: "id", value: "q-9" },
      { op: "delete", column: "user_id", value: "user-a" },
    ]);
  });

  it("throws on a database error, without the driver's message", async () => {
    const failing = fakeClient({ deleteError: { message: "boom" } });
    await expect(deleteQuestion(failing, "q-9", "user-a")).rejects.toThrow(
      /history delete failed/,
    );
    await expect(deleteQuestion(failing, "q-9", "user-a")).rejects.not.toThrow(
      /boom/,
    );
  });
});
