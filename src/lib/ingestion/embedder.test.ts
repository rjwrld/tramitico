import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedder } from "./embedder";

describe("createEmbedder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to stub when EMBEDDINGS_PROVIDER is unset", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", undefined as unknown as string);
    expect(createEmbedder().provider).toBe("stub");
  });

  it('defaults to stub when EMBEDDINGS_PROVIDER is empty — CI interpolates unset vars as ""', () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "");
    expect(createEmbedder().provider).toBe("stub");
  });

  it("rejects an unknown provider", () => {
    expect(() => createEmbedder("no-such-provider")).toThrow(
      /Unknown EMBEDDINGS_PROVIDER/,
    );
  });
});
