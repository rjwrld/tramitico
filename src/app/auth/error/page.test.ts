import { describe, expect, it } from "vitest";

import { metadata } from "./page";

describe("auth error page metadata", () => {
  it("names the page once — the root template adds the wordmark", () => {
    expect(metadata.title).toBe("Error de sesión");
  });

  it("keeps an error page out of the index", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
