import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Hermetic-build guard (issue #83). `next/font/google` downloads the font files
 * at build time, so importing it makes `pnpm build` depend on Google's font
 * hosts — a network flake there fails CI with a module-resolution error naming
 * an internal Turbopack module, which points diagnosis in entirely the wrong
 * direction. Fonts now come from the `geist` package and a vendored woff2 under
 * src/app/fonts/; this keeps them there.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "playwright-report",
  "test-results",
  "coverage",
]);

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|css)$/;

/**
 * Both ways the build could reach Google: the loader import, and a stylesheet
 * pulling the hosts directly. Patterns are built from parts so this file's own
 * prose can name what it bans without tripping the check.
 */
const GOOGLE_FONTS = [
  { what: "a next/font/google import", pattern: /["']next\/font\/google["']/ },
  { what: "a Google font host", pattern: /fonts\.(googleapis|gstatic)\.com/ },
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (SKIP_DIRS.has(entry.name)) return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE_FILE.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

describe("font loading", () => {
  it("reaches Google for a font in no source file", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(REPO_ROOT)) {
      const source = await readFile(file, "utf8");
      for (const { what, pattern } of GOOGLE_FONTS) {
        if (pattern.test(source)) {
          offenders.push(`${file.slice(REPO_ROOT.length + 1)} — ${what}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
