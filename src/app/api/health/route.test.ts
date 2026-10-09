import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tryServiceClient } from "@/lib/supabase/service";

import { GET } from "./route";

vi.mock("@/lib/supabase/service", () => ({ tryServiceClient: vi.fn() }));

/** What `.from(...).select(...).limit(...).abortSignal(...)` settles to. */
type ReadResult = { data?: unknown; error: unknown };

/** A client whose one read settles as given, recording the query it saw. */
function clientReading(result: () => Promise<ReadResult>) {
  const query = {
    select: vi.fn(() => query),
    limit: vi.fn(() => query),
    abortSignal: vi.fn(result),
  };
  const from = vi.fn(() => query);
  vi.mocked(tryServiceClient).mockReturnValue({ from } as never);
  return { from, query };
}

/** Every string the route logged — what a log drain would see. */
function logged(): string {
  return vi.mocked(console.error).mock.calls.flat().join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(tryServiceClient).mockReset();
});

describe("GET /api/health", () => {
  it("answers ok after reading one row from documents", async () => {
    const { from, query } = clientReading(async () => ({
      data: [{ id: "x" }],
      error: null,
    }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(from).toHaveBeenCalledWith("documents");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("answers ok on an empty documents table — the database still answered", async () => {
    clientReading(async () => ({ data: [], error: null }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("is never cached, up or down", async () => {
    clientReading(async () => ({ data: [], error: null }));
    expect((await GET()).headers.get("cache-control")).toBe("no-store");

    clientReading(async () => ({ error: { code: "PGRST301" } }));
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 without detail when the read returns an error", async () => {
    const error = Object.assign(
      new Error("relation documents: ¿cómo declaro el D-101?"),
      { name: "PostgrestError", code: "57P01" },
    );
    clientReading(async () => ({ data: null, error }));

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "unavailable" });
    expect(body).not.toContain("57P01");
    expect(logged()).toBe(
      "[health] unavailable — error=Error.PostgrestError#57P01",
    );
    expect(logged()).not.toContain("D-101");
  });

  it("answers 503 when the read throws — a paused project, a timeout", async () => {
    clientReading(() =>
      Promise.reject(new DOMException("signal timed out", "TimeoutError")),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(logged()).toBe(
      "[health] unavailable — error=DOMException.TimeoutError#23",
    );
  });

  it("answers 503 when the service client cannot be built", async () => {
    vi.mocked(tryServiceClient).mockReturnValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(logged()).toBe("[health] unavailable — reason=config");
  });
});
