import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Three projects, three CI lanes (issue #129): `unit` needs no environment and
 * is the required check; `integration` needs a database; `eval` needs a
 * database plus real embeddings and an Anthropic key. Suites are assigned by
 * filename — `*.integration.test.ts` under `src/lib/eval` is an eval, anywhere
 * else it is an integration test, everything else is a unit test.
 *
 * `pnpm test` still runs all three, for local convenience.
 */
const EVAL_SUITES = "src/lib/eval/**/*.integration.test.ts";
const INTEGRATION_SUITES = "src/**/*.integration.test.ts";

const shared = {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
          exclude: [...configDefaults.exclude, INTEGRATION_SUITES],
          // Component tests opt into jsdom with a `@vitest-environment jsdom`
          // docblock.
          environment: "node",
        },
      },
      {
        ...shared,
        test: {
          name: "integration",
          include: [INTEGRATION_SUITES],
          exclude: [...configDefaults.exclude, EVAL_SUITES],
          environment: "node",
        },
      },
      {
        ...shared,
        test: {
          name: "eval",
          include: [EVAL_SUITES],
          exclude: [...configDefaults.exclude],
          environment: "node",
        },
      },
    ],
  },
});
