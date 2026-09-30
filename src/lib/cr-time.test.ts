import { describe, expect, it } from "vitest";
import { crDate } from "./cr-time";

describe("crDate", () => {
  it("rolls to the next date at 06:00 UTC, not at 00:00 UTC", () => {
    expect(crDate(new Date("2026-08-12T05:59:59Z"))).toBe("2026-08-11");
    expect(crDate(new Date("2026-08-12T06:00:00Z"))).toBe("2026-08-12");
  });

  it("keeps a UTC-midnight crossing inside the same CR day", () => {
    expect(crDate(new Date("2026-08-11T23:59:59Z"))).toBe("2026-08-11");
    expect(crDate(new Date("2026-08-12T00:00:01Z"))).toBe("2026-08-11");
  });
});
