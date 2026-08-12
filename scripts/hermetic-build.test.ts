import { describe, expect, it } from "vitest";
import { describeFailure, networkSignatures } from "./hermetic-build";

/**
 * The gate's whole point is requirement 2 of #88: when a sandboxed build
 * fails, the output has to name the network rather than reproduce the
 * Turbopack-internal misdirection that cost #83 a wild goose chase.
 */
describe("networkSignatures", () => {
  it("finds the syscall-level errors a denied route produces", () => {
    expect(
      networkSignatures("Error: connect ENETUNREACH 142.250.1.1:443"),
    ).toHaveLength(1);
    expect(
      networkSignatures("getaddrinfo EAI_AGAIN registry.example.com"),
    ).toHaveLength(2);
  });

  it("finds undici's opaque wrapper", () => {
    expect(networkSignatures("TypeError: fetch failed")).toHaveLength(1);
  });

  it("finds the #83 misdirection itself", () => {
    const log =
      "Module not found: Can't resolve " +
      "'@vercel/turbopack-next/internal/font/google/font'";
    expect(networkSignatures(log)).toEqual([
      "a Turbopack font-loader internal",
    ]);
  });

  it("stays quiet on an ordinary build failure", () => {
    const log = "Type error: Property 'foo' does not exist on type 'Bar'.";
    expect(networkSignatures(log)).toEqual([]);
  });

  it("does not fire on words that merely contain a signature", () => {
    expect(networkSignatures("PREFETCHED failed to warm")).toEqual([]);
  });
});

describe("describeFailure", () => {
  it("names the network, and what matched, when a signature is present", () => {
    const message = describeFailure("Error: connect ENETUNREACH 1.1.1.1:443");
    expect(message).toContain("the build tried to reach the network");
    expect(message).toContain("ENETUNREACH");
  });

  it("does not claim the network when nothing points there", () => {
    const message = describeFailure("Type error: something unrelated");
    expect(message).not.toContain("the build tried to reach the network");
    expect(message).toContain("not visibly on the network");
  });

  it("always says which sandbox the build ran under, and how to repeat it", () => {
    for (const log of ["ENETUNREACH", "an ordinary failure"]) {
      expect(describeFailure(log)).toContain("network namespace");
      expect(describeFailure(log)).toContain("pnpm build:hermetic");
    }
  });
});
