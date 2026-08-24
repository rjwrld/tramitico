// DESIGN §2's contrast floors, enforced against the stylesheet the app ships.
//
// Issue #160: destructive controls sat at 3.35:1 in dark mode because the
// ground was an *alpha of the text colour* — in dark mode every unit of
// self-tint pulls the ground toward the text, so no token value could reach
// 4.5:1. The fix pairs `--destructive` with an independently-tuned
// `--destructive-bg` / `--destructive-bg-hover`, mirroring `--sello` /
// `--sello-bg`. These assertions are what keep the alpha pattern from
// coming back.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastOf, readThemeTokens } from "./contrast";

const AA_TEXT = 4.5;

const css = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
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
  ])("%s meets AA for text", (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("does not derive the destructive ground from the destructive text", () => {
    // The #160 regression, stated as code: a ground that is an alpha of the
    // text colour would be an `oklch` sharing the text's chroma and hue.
    const [, textChroma, textHue] = t["--destructive"].match(
      /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/,
    )!;
    const ground = t["--destructive-bg"];
    expect(ground).not.toContain(`${textChroma} ${textHue}`);
  });
});
