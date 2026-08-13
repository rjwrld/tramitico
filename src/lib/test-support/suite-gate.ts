/**
 * The shared gate for env-dependent suites (issue #129).
 *
 * The rule it encodes: a suite whose prerequisites are absent skips on a
 * developer's laptop and *fails* on CI. Skipping on CI is what let a required
 * check pass green while asserting nothing — the failure mode this replaces.
 * The failing test names the missing prerequisites, so a red CI job is read
 * once and understood.
 *
 * Importing this module also loads `.env.local`, so a local `supabase start`
 * stack lights the integration suites up without exporting anything by hand.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

/** Prerequisite label (an env var name, or a phrase) → is it satisfied? */
export type Prerequisites = Record<string, boolean>;

export type GateMode = "run" | "skip" | "fail";

export interface GateDecision {
  mode: GateMode;
  missing: string[];
}

export function missingPrerequisites(prereqs: Prerequisites): string[] {
  return Object.entries(prereqs)
    .filter(([, met]) => !met)
    .map(([label]) => label);
}

export function isCi(env: Record<string, string | undefined>): boolean {
  const ci = env.CI;
  return ci !== undefined && ci !== "" && ci !== "false" && ci !== "0";
}

export function gateDecision(
  prereqs: Prerequisites,
  ci: boolean,
): GateDecision {
  const missing = missingPrerequisites(prereqs);
  if (missing.length === 0) return { mode: "run", missing };
  return { mode: ci ? "fail" : "skip", missing };
}

/**
 * Loads `.env.local` into `process.env` without overwriting anything already
 * set, so an explicit `SUPABASE_URL=… pnpm test:integration` still wins.
 */
export function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "../../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

loadDotEnvLocal();

/** Builds prerequisites from env var names — present and non-empty. */
export function envPrereqs(...names: string[]): Prerequisites {
  return Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
}

/**
 * A drop-in `describe` for suites that need an environment: it runs the suite
 * when the prerequisites hold, skips it locally when they don't, and on CI
 * replaces it with a single failing test naming what is missing.
 *
 *   const describeDb = integrationSuite(envPrereqs("SUPABASE_URL"));
 *   describeDb("…", () => { … });
 *
 * The suite body is never evaluated on the failing path — an unset variable
 * would otherwise surface as a collection crash from some client constructor
 * instead of the message. For the same reason, keep anything that can throw
 * without the environment (client and embedder constructors) inside the body.
 */
export function integrationSuite(
  prereqs: Prerequisites,
): (name: string, fn: () => void) => void {
  const { mode, missing } = gateDecision(prereqs, isCi(process.env));
  return (name, fn) => {
    if (mode === "run") return void describe(name, fn);
    if (mode === "skip") return void describe.skip(name, fn);
    describe(name, () => {
      it("integration prerequisites are present", () => {
        throw new Error(
          `${name}: cannot run on CI — missing ${missing.join(", ")}. ` +
            `Integration and eval suites fail rather than skip under CI so a ` +
            `required check can never pass while asserting nothing (issue #129).`,
        );
      });
    });
  };
}
