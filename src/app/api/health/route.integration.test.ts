/**
 * `/api/health` against a real database (#553): the service-role read the
 * uptime monitor depends on actually reaches `documents`. CI's stack is
 * migrated and empty, the shared local one carries the corpus; the route
 * answers ok on both, since an empty table is still a database that answered.
 *
 * Env-gated: skipped locally unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set; on CI a missing one fails the integration job instead (#129).
 */
import { expect, it } from "vitest";

import { envPrereqs, integrationSuite } from "@/lib/test-support/suite-gate";

import { GET } from "./route";

const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

describeDb("GET /api/health against the database", () => {
  it("answers ok, uncached", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
