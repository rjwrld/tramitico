import { existsSync, readFileSync } from "node:fs";

/**
 * Back-fills what `pnpm ingest` was not given from the dev `.env.local`,
 * without overwriting anything already set, so `SUPABASE_URL=… pnpm ingest`
 * still wins.
 *
 * Skipped when `INGEST_NO_DOTENV` is set to anything: `pnpm recrawl`
 * (scripts/recrawl.sh) drives a production ingest with exactly the keys it
 * needs, and the dev file — symlinked into every worktree — must not fill in
 * whatever that environment left out.
 */
export function loadDotEnvLocal(
  file: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.INGEST_NO_DOTENV) return;
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
