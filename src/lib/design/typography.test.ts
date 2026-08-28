// DESIGN §3's letter-spacing floor, enforced against the tree that ships.
//
// Issue #215: four display headings used Tailwind's `tracking-tight`, which is
// −0.025em — past §3's "never tighter than −0.02em". The floor is now a token
// (`--tracking-display`, so `tracking-display`), and the classes that undercut
// it are banned here. Prose in DESIGN did not fail CI; this does.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../..");

const FLOOR_EM = -0.02;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
      ? [full]
      : [];
  });

describe("display letter-spacing", () => {
  it("declares the floor as a token", () => {
    const css = readFileSync(path.resolve(srcDir, "app/globals.css"), "utf8");
    expect(css).toContain(`--tracking-display: ${FLOOR_EM}em;`);
  });

  it.each(
    walk(path.resolve(srcDir, "components"))
      .concat(walk(path.resolve(srcDir, "app")))
      .map((f) => [path.relative(srcDir, f), f]),
  )("%s stays at or above the -0.02em floor", (_name, file) => {
    const code = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
    // Tailwind's own scale: `tracking-tight` is -0.025em and
    // `tracking-tighter` -0.05em. Both undercut §3.
    expect(code).not.toMatch(/\btracking-tighter?\b/);
    // An arbitrary value can undercut it just as easily.
    for (const [, raw] of code.matchAll(/\btracking-\[(-?[\d.]+)em\]/g)) {
      expect(Number(raw)).toBeGreaterThanOrEqual(FLOOR_EM);
    }
  });
});
