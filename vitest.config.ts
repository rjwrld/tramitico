import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Three projects, three CI lanes (issues #129, #147), split by what a suite
 * *needs* rather than by where it lives:
 *
 *   unit         nothing. The required per-PR check.
 *   integration  a database with the migrations applied and no data in it.
 *                CI gets one from `supabase start` on every PR — no secrets,
 *                no hosted project (#147).
 *   eval         a database carrying the *ingested corpus*, plus real
 *                embeddings and an Anthropic key. Secrets-fed, so it runs on
 *                its own schedule (.github/workflows/eval.yml), not per PR.
 *
 * The filename says which: `*.integration.test.ts` for the schema-only lane,
 * `*.eval.test.ts` for the corpus lane, anywhere under `src/`. Directory no
 * longer decides — `src/lib/retrieval.eval.test.ts` sits next to the module it
 * covers while running in the corpus lane, which the old `src/lib/eval/**`
 * rule could not express.
 *
 * The dividing question when adding a suite: would it pass against a database
 * that has just been migrated and holds no rows? Yes → integration. No → eval.
 *
 * That question is why the real-table dataset census stays in the eval lane
 * (#163). Credential-wise it is database-only — no embeddings, no Anthropic
 * key — but it asserts that every target in eval/dataset.jsonl is matched by
 * at least one row in `public.chunks`, so on the per-PR lane's empty stack
 * every target would MISS and it would fail on every PR. Moving the suite is
 * not the remedy; carrying the *answer* is. `eval/corpus-index.json` is a
 * committed dump of the distinct `(docKey, articulo, path)` triples the corpus
 * holds, re-written by `pnpm ingest` on every run, and
 * `dataset-satisfiability.test.ts` runs the same census over it in the unit
 * lane — so a PR adding an unsatisfiable target goes red with no database and
 * no secrets. The eval-lane twin keeps the real-table census and additionally
 * fails when the committed dump has drifted from the table.
 *
 * `pnpm test` still runs all three, for local convenience.
 */
const EVAL_SUITES = "src/**/*.eval.test.ts";
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
          exclude: [...configDefaults.exclude, INTEGRATION_SUITES, EVAL_SUITES],
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
          exclude: [...configDefaults.exclude],
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
