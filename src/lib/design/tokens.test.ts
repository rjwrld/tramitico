// DESIGN §2's contrast floors, enforced against the stylesheet the app ships.
//
// Issue #160: destructive controls sat at 3.35:1 in dark mode because the
// ground was an *alpha of the text colour* — in dark mode every unit of
// self-tint pulls the ground toward the text, so no token value could reach
// 4.5:1. The fix pairs `--destructive` with an independently-tuned
// `--destructive-bg` / `--destructive-bg-hover`, mirroring `--sello` /
// `--sello-bg`. These assertions are what keep the alpha pattern from
// coming back.
//
// Issue #215 is the same defect on the *hover* half of the one sanctioned CTA:
// the filled primary hovered at `bg-primary/80`, an alpha of the ground against
// the page, which composited its label down to ≈2.92:1 in light mode. The hover
// ground is now `--primary-hover`, asserted below in both themes.
//
// Issue #165 extends the same argument to a non-text pair: `ConfirmInline`'s
// `border-destructive/30` measured 1.81:1 / 1.58:1 against the surfaces it
// lands on, under WCAG 1.4.11's 3:1 floor for non-text UI. It is now
// `--destructive-border`, asserted below at 3:1 and pinned in the component.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastOf, readThemeTokens } from "./contrast";

const AA_TEXT = 4.5;
// WCAG 1.4.11: non-text UI (borders, rules, control boundaries) clears 3:1.
const AA_NON_TEXT = 3;

// Resolved relative to this file, not `process.cwd()`: the unit project is the
// required CI gate and CLAUDE.md says it needs no environment — including no
// assumption about which directory the runner was invoked from.
const css = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/globals.css",
  ),
  "utf8",
);
const themes = {
  light: readThemeTokens(css, ":root"),
  dark: readThemeTokens(css, ".dark"),
} as const;

describe.each(["light", "dark"] as const)("%s theme tokens", (theme) => {
  const t = themes[theme];
  const ratio = (fg: string, bg: string) => contrastOf(t[fg], t[bg]);

  it.each([
    ["--destructive on --destructive-bg", "--destructive", "--destructive-bg"],
    [
      "--destructive on --destructive-bg-hover",
      "--destructive",
      "--destructive-bg-hover",
    ],
    // ConfirmInline's prompt copy sits on the surface it is rendered into:
    // the page in the sidebar, the popover inside the account menu.
    ["--destructive on --background", "--destructive", "--background"],
    ["--destructive on --popover", "--destructive", "--popover"],
    // The floors DESIGN §2 already claimed, so they stop being prose.
    ["--foreground on --background", "--foreground", "--background"],
    [
      "--muted-foreground on --background",
      "--muted-foreground",
      "--background",
    ],
    ["--sello on --sello-bg", "--sello", "--sello-bg"],
    ["--primary-foreground on --primary", "--primary-foreground", "--primary"],
    // Issue #215: the hovered CTA is a state a user reads text in, so it
    // carries the same AA floor as the resting one.
    [
      "--primary-foreground on --primary-hover",
      "--primary-foreground",
      "--primary-hover",
    ],
  ])("%s meets AA for text", (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // WCAG 1.4.11. `ConfirmInline`'s container is transparent, so its border is
  // measured against the two surfaces it is actually rendered into.
  it.each([
    [
      "--destructive-border on --background",
      "--destructive-border",
      "--background",
    ],
    ["--destructive-border on --popover", "--destructive-border", "--popover"],
  ])("%s meets AA for non-text UI", (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("moves the primary hover ground away from the page, not toward it", () => {
    // The #215 regression stated as a value: `bg-primary/80` composites toward
    // `--background`, so in light mode the hover ground gets *lighter* than
    // the resting one and the pale label loses contrast. Whichever direction
    // the theme runs, the hover ground must move away from the page.
    const lightness = (token: string) => {
      const match = /oklch\(([\d.]+)/.exec(t[token]);
      if (!match) throw new Error(`${token} is not oklch(): ${t[token]}`);
      return Number(match[1]);
    };
    const towardPage = Math.sign(
      lightness("--background") - lightness("--primary"),
    );
    const moved = Math.sign(
      lightness("--primary-hover") - lightness("--primary"),
    );
    expect(moved).not.toBe(0);
    expect(moved).toBe(-towardPage);
  });

  it("does not derive the destructive ground from the destructive text", () => {
    // The #160 regression, stated as code: a ground that is an alpha of the
    // text colour would be an `oklch` sharing the text's chroma and hue.
    const text = /oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(
      t["--destructive"],
    );
    if (!text)
      throw new Error(`--destructive is not oklch(): ${t["--destructive"]}`);

    const [, , chroma, hue] = text;
    expect(t["--destructive-bg"]).not.toMatch(
      new RegExp(`${chroma}\\s+${hue}\\)`),
    );
  });
});

// A token pair only helps where it is actually used. `bg-destructive/<alpha>`
// is the #160 defect written as a utility class: it computes the ground from
// the text colour at paint time, so it would sail past every assertion above
// and still ship a 3.35:1 control. `bg-primary/<alpha>` is the same defect on
// the CTA hover (#215). Ban them in the tree instead.
describe("tinted grounds in components", () => {
  const componentsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../components",
  );

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [full]
        : [];
    });

  it.each(walk(componentsDir).map((f) => [path.relative(componentsDir, f), f]))(
    "%s grounds destructive surfaces in --destructive-bg",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      // Rings and invalid-state borders may still be alphas — they are not
      // text grounds, and an aria-invalid ring is not the delineating rule of a
      // destructive zone. `ConfirmInline`'s container border is (issue #165),
      // and it is checked separately below.
      expect(source).not.toMatch(/\bbg-destructive\/\d/);
    },
  );

  it("grounds the filled primary hover in --primary-hover", () => {
    const source = readFileSync(
      path.join(componentsDir, "ui", "button.tsx"),
      "utf8",
    );
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    // The #215 defect as a utility class: an alpha of the ground composites at
    // paint time, so the token assertions above would never see it.
    expect(code).not.toMatch(/\bbg-primary\/\d/);
    expect(code).toContain("hover:bg-primary-hover");
  });

  it("draws the ConfirmInline zone rule from --destructive-border", () => {
    const source = readFileSync(
      path.join(componentsDir, "ui", "confirm-inline.tsx"),
      "utf8",
    );
    // Line comments stripped first — the file's own header names the retired
    // class, and that mention must not read as a use of it.
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    // The #165 defect as a utility class: an alpha of the text colour on the
    // container border computes at paint time, so the token assertions above
    // would never see it.
    expect(code).not.toMatch(/\bborder-destructive\/\d/);
    expect(code).toContain("border-destructive-border");
  });
});
