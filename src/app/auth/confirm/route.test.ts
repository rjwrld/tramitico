import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSentinel(to);
  }),
}));

import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

/** `redirect()` never returns in Next.js; the mock throws so the route stops. */
class RedirectSentinel extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}

function mockVerify(error: { message: string } | null = null) {
  const verifyOtp = vi.fn().mockResolvedValue({ error });
  vi.mocked(createClient).mockResolvedValue({
    auth: { verifyOtp },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return verifyOtp;
}

async function redirectedTo(url: string): Promise<string> {
  try {
    await GET(new Request(url) as never);
  } catch (err) {
    if (err instanceof RedirectSentinel) return err.to;
    throw err;
  }
  throw new Error("route returned without redirecting");
}

const confirmUrl = (params: Record<string, string>) =>
  `https://app.example/auth/confirm?${new URLSearchParams(params)}`;

describe("GET /auth/confirm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redeems an email token and lands on the requested page", async () => {
    const verifyOtp = mockVerify();
    const to = await redirectedTo(
      confirmUrl({ token_hash: "tok", type: "email", next: "/historial" }),
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "tok",
    });
    expect(to).toBe("/historial");
  });

  it("lands on /auth/error when the Auth server rejects the token", async () => {
    mockVerify({ message: "Token has expired or is invalid" });
    expect(
      await redirectedTo(confirmUrl({ token_hash: "tok", type: "email" })),
    ).toBe("/auth/error");
  });

  it.each([
    "recovery",
    "invite",
    "signup",
    "magiclink",
    "email_change",
    "sms",
    "",
  ])("does not forward type %j to the Auth server", async (type) => {
    const verifyOtp = mockVerify();
    const to = await redirectedTo(confirmUrl({ token_hash: "tok", type }));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(to).toBe("/auth/error");
  });

  it("does not call the Auth server without a token hash", async () => {
    const verifyOtp = mockVerify();
    expect(await redirectedTo(confirmUrl({ type: "email" }))).toBe(
      "/auth/error",
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
