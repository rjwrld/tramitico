import { describe, expect, it } from "vitest";
import { cn, safeNextPath } from "./utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/historial")).toBe("/historial");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/historial?tab=recientes#top")).toBe(
      "/historial?tab=recientes#top",
    );
  });

  it("falls back to / for absolute or protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("falls back to / for backslash variants browsers read as //", () => {
    // WHATWG URL: `\` ≡ `/` for http(s), so all of these are off-origin.
    expect(safeNextPath("\\/evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("/\\/evil.com")).toBe("/");
    expect(safeNextPath("\\\\evil.com")).toBe("/");
    // Backslash anywhere is rejected — no legitimate path carries one.
    expect(safeNextPath("/historial\\evil.com")).toBe("/");
  });

  it("falls back to / for %5C variants once the query layer decodes them", () => {
    // Call sites read `next` via URLSearchParams, which percent-decodes; a
    // crafted `?next=/%5Cevil.com` reaches safeNextPath as `/\evil.com`.
    const decoded = new URLSearchParams("next=/%5Cevil.com").get("next");
    expect(decoded).toBe("/\\evil.com");
    expect(safeNextPath(decoded)).toBe("/");
    expect(
      safeNextPath(new URLSearchParams("next=%5C/evil.com").get("next")),
    ).toBe("/");
  });
});
