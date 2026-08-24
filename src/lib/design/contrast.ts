// WCAG contrast for the DESIGN §2 tokens, computed from the oklch values as
// written in `globals.css` (issue #160).
//
// Why this exists: DESIGN §2 states contrast floors in prose, and prose does
// not fail CI. #160 shipped a destructive pair at 3.35:1 in dark mode for
// exactly that reason — nothing measured it. This module is the measuring
// stick; `tokens.test.ts` is the check.
//
// The pipeline is oklch → linear sRGB → WCAG relative luminance → ratio.

type Rgb = readonly [number, number, number];

// Oklab → LMS (cube roots), then LMS → linear sRGB. Björn Ottosson's matrices.
const OKLAB_TO_LMS = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
] as const;

const LMS_TO_LINEAR_SRGB = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Parse a CSS `oklch(L C H)` string into gamut-clamped linear sRGB.
 * Throws on anything it cannot parse — a silently-zeroed colour would make
 * every ratio look fine.
 */
export function parseOklch(css: string): Rgb {
  const match = OKLCH.exec(css.trim());
  if (!match) throw new Error(`not an oklch() colour: ${css}`);

  const [l, c, hDeg] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const h = (hDeg * Math.PI) / 180;
  const lab = [l, c * Math.cos(h), c * Math.sin(h)] as const;

  const lms = OKLAB_TO_LMS.map(
    ([p, q, r]) => (p * lab[0] + q * lab[1] + r * lab[2]) ** 3,
  );

  const [r, g, b] = LMS_TO_LINEAR_SRGB.map(([p, q, s]) =>
    clamp(p * lms[0] + q * lms[1] + s * lms[2]),
  );
  return [r, g, b] as const;
}

/** WCAG 2.x relative luminance of a linear-sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1:1 … 21:1. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast between two `oklch()` strings, the form tokens are written in. */
export function contrastOf(foreground: string, background: string): number {
  return contrastRatio(parseOklch(foreground), parseOklch(background));
}

/**
 * Pull the custom properties out of one `:root { … }` / `.dark { … }` block of
 * `globals.css`, so a check can assert against the values the app actually
 * ships rather than a copy that drifts.
 */
export function readThemeTokens(
  css: string,
  selector: ":root" | ".dark",
): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in stylesheet`);
  const end = css.indexOf("\n}", start);
  if (end === -1) throw new Error(`unterminated ${selector} block`);

  const tokens: Record<string, string> = {};
  for (const [, name, value] of css
    .slice(start, end)
    .matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}
