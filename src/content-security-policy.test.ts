import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "../next.config";

function scriptSrc(policy: string): string | undefined {
  return policy
    .split("; ")
    .find((directive) => directive.startsWith("script-src"));
}

describe("contentSecurityPolicy (#478)", () => {
  it("lets `next dev` eval, so React's dev callstacks stop logging an error", () => {
    expect(scriptSrc(contentSecurityPolicy("development"))).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });

  it("never carries 'unsafe-eval' outside development", () => {
    for (const env of ["production", "test", undefined]) {
      const policy = contentSecurityPolicy(env);
      expect(policy).not.toContain("unsafe-eval");
      expect(scriptSrc(policy)).toBe("script-src 'self' 'unsafe-inline'");
    }
  });
});
