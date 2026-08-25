import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  historySaveFailures,
  recordHistorySaveFailure,
  resetHistorySaveFailures,
} from "./persist-failure";

describe("the history-save failure counter (#139 req. 2)", () => {
  beforeEach(() => {
    resetHistorySaveFailures();
    vi.restoreAllMocks();
  });

  it("starts at zero for both answer kinds", () => {
    expect(historySaveFailures()).toEqual({ answer: 0, decline: 0 });
  });

  it("counts each lost exchange under the kind of answer it lost", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordHistorySaveFailure({ kind: "answer" });
    recordHistorySaveFailure({ kind: "answer", error: new Error("db down") });
    recordHistorySaveFailure({ kind: "decline" });

    expect(historySaveFailures()).toEqual({ answer: 2, decline: 1 });
  });

  it("logs a rejected save on a stable, greppable prefix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordHistorySaveFailure({ kind: "answer", error: new Error("db down") });

    expect(warn).toHaveBeenCalledWith(
      "ask: history save failed — kind=answer error=Error: db down",
    );
  });

  it("names the insert itself when there was no exception to name", () => {
    // `saveQuestion` returned false: it already logged the Postgres message,
    // so the counter line only says which door the failure came through.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordHistorySaveFailure({ kind: "decline" });

    expect(warn).toHaveBeenCalledWith(
      "ask: history save failed — kind=decline error=insert",
    );
  });

  it("hands back a copy — a caller cannot drive the counter through it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = historySaveFailures();
    snapshot.answer = 99;
    recordHistorySaveFailure({ kind: "answer" });

    expect(historySaveFailures().answer).toBe(1);
  });
});
