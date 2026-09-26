import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvLocal } from "./dotenv-local";

describe("loadDotEnvLocal", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "dotenv-local-"));
    file = path.join(dir, ".env.local");
    writeFileSync(
      file,
      [
        "SUPABASE_URL=http://dev-stack.invalid",
        "EMBEDDINGS_PROVIDER=stub",
        "# a comment",
        "",
      ].join("\n"),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("fills what is unset and leaves what is set", () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: "http://given.invalid",
    };
    loadDotEnvLocal(file, env);
    expect(env).toEqual({
      SUPABASE_URL: "http://given.invalid",
      EMBEDDINGS_PROVIDER: "stub",
    });
  });

  it("fills nothing when the re-crawl sets INGEST_NO_DOTENV", () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: "http://given.invalid",
      INGEST_NO_DOTENV: "1",
    };
    loadDotEnvLocal(file, env);
    expect(env).toEqual({
      SUPABASE_URL: "http://given.invalid",
      INGEST_NO_DOTENV: "1",
    });
  });

  it("does nothing without the file", () => {
    const env: Record<string, string | undefined> = {};
    loadDotEnvLocal(path.join(dir, "absent"), env);
    expect(env).toEqual({});
  });
});
