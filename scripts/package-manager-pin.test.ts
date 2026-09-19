import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `pnpm-workspace.yaml`'s `allowBuilds` allowlist only means something under
 * pnpm ≥ 10's default-deny lifecycle-script policy. The GitHub Actions jobs
 * used to pin the major in each workflow; the Vercel build read nothing. The
 * `packageManager` field is the one place every installer — Actions, Vercel,
 * a laptop — reads, so it is the pin, and the workflows defer to it
 * (pnpm/action-setup errors when both are set and disagree).
 */
const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  packageManager?: string;
};

/** The `with:` lines of every `pnpm/action-setup` step, per workflow file. */
function actionSetupSteps(): { file: string; step: string[] }[] {
  const dir = join(root, ".github/workflows");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .flatMap((file) => {
      const lines = readFileSync(join(dir, file), "utf8").split("\n");
      const steps: { file: string; step: string[] }[] = [];
      lines.forEach((line, i) => {
        if (!/^\s*- uses: pnpm\/action-setup@/.test(line)) return;
        const step: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s*- /.test(lines[j]) || /^\S/.test(lines[j])) break;
          step.push(lines[j]);
        }
        steps.push({ file, step });
      });
      return steps;
    });
}

describe("pnpm version pin", () => {
  it("pins an exact pnpm 11 in package.json", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@11\.\d+\.\d+$/);
  });

  it("lets every workflow's pnpm/action-setup read that pin", () => {
    const steps = actionSetupSteps();
    expect(steps.length).toBeGreaterThan(0);
    for (const { file, step } of steps) {
      const pinned = step.find((line) => /^\s+version:/.test(line));
      expect(pinned, `${file} pins a second pnpm version`).toBeUndefined();
    }
  });
});
