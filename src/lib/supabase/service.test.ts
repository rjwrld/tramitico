import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceClient, tryServiceClient } from "./service";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serviceClient", () => {
  it("throws naming both env vars when SUPABASE_URL is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    expect(() => serviceClient()).toThrow(
      /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("throws naming both env vars when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => serviceClient()).toThrow(
      /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("returns a client when both env vars are set", () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    const client = serviceClient();
    expect(client.rpc).toBeTypeOf("function");
    expect(client.from).toBeTypeOf("function");
  });
});

describe("tryServiceClient", () => {
  it("returns null instead of throwing when env is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(tryServiceClient()).toBeNull();
  });

  it("returns a client when both env vars are set", () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    expect(tryServiceClient()).not.toBeNull();
  });
});
