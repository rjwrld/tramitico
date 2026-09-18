import { describe, expect, it } from "vitest";
import * as z from "zod";

import "./instrumentation-client";

/**
 * The E2E happy path is what proves `jitless` suppresses the CSP violation
 * (#137); this guards the setting itself, which is easy to drop by accident
 * and whose loss would surface as a blocked compile under the enforced CSP.
 */
describe("instrumentation-client", () => {
  it("puts Zod in jitless mode so no validator is compiled with new Function", () => {
    expect(z.config().jitless).toBe(true);
  });
});
