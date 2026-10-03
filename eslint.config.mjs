import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Supabase scratch state — generated bundles, not our source.
    "supabase/.temp/**",
    // Orca worktrees: other checkouts of this repo, nested inside this one
    // (see `/tramitico/` in .gitignore). Each lints itself; from here they
    // are 288 duplicate files (#480).
    "tramitico/**",
  ]),
]);

export default eslintConfig;
