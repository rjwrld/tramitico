/**
 * The `t·` sello mark — DESIGN §4's one permitted icon treatment.
 *
 * "No logo mark in MVP — the wordmark is the mark. The favicon is a minimal
 * 't·' in the sello style (red on paper / warm-red on ink). Never a flag,
 * never a mascot." Issue #217: `src/app/favicon.ico` shipped as the
 * unmodified create-next-app triangle until this landed.
 *
 * The glyphs are the *real* Source Serif 4 outlines, so the mark's `t` is the
 * same letter the wordmark sets. They were lifted once from the vendored
 * variable font (`src/app/fonts/SourceSerif4-Variable-latin.woff2`) at
 * `wght: 600` — DESIGN §3's heavier display instance, which is the one that
 * survives 16px — with fontTools' `instantiateVariableFont` + `SVGPathPen`,
 * and are pinned here as path data. Font units, 1000/em, y-up.
 *
 * Nothing here touches the filesystem: `scripts/generate-icons.ts` turns this
 * geometry into `src/app/icon.svg` and `src/app/favicon.ico`, and
 * `scripts/generate-icons.test.ts` regenerates both and diffs them against the
 * committed bytes.
 */

/** One glyph as the font draws it: outline plus the metrics to place it. */
type Glyph = {
  /** Path data in font units, y-up, origin at the glyph's pen position. */
  readonly d: string;
  /** Ink bounds `[xMin, yMin, xMax, yMax]`, font units. */
  readonly bounds: readonly [number, number, number, number];
  /** Horizontal advance, font units. */
  readonly advance: number;
};

const T: Glyph = {
  d: "M158.3 427.4V492.7H345.3V427.4ZM231 -11.7Q168.4 -11.7 131.1 21.2Q93.8 54.0 93.8 125.6Q93.8 146.9 93.8 166.9Q93.8 186.8 93.8 211.2V427.4H16.4V481.7L139.7 497.7L95.5 463.7L144.6 633.6H225.8L215.8 463.9L219.8 453.9V134.6Q219.8 97.2 235.6 80.9Q251.5 64.5 278.8 64.5Q296.2 64.5 310.3 69.7Q324.5 74.9 337.5 81.9L361.2 41.3Q350.2 28.3 332.2 15.6Q314.2 3.0 288.8 -4.3Q263.3 -11.7 231 -11.7Z",
  bounds: [16.4, -11.7, 361.2, 633.6],
  advance: 369,
};

const PERIODCENTERED: Glyph = {
  d: "M153.3 256.7Q118.7 256.7 95.4 280.5Q72.1 304.3 72.1 337.6Q72.1 372.3 95.4 396.2Q118.7 420.2 153.3 420.2Q187.9 420.2 211.9 396.2Q235.9 372.3 235.9 337.6Q235.9 304.3 211.9 280.5Q187.9 256.7 153.3 256.7Z",
  bounds: [72.1, 256.7, 235.9, 420.2],
  advance: 307,
};

/**
 * Tracking between the two glyphs, font units (1000/em). DESIGN §3: "Display
 * letter-spacing never tighter than −0.02em" — this is exactly that floor,
 * which pulls the dot into the `t`'s ear rather than leaving it adrift.
 */
const TRACKING = -20;

/** The icon's own coordinate box. Everything below is in these units. */
export const VIEWBOX = 32;

/**
 * Clear space around the ink. Four units of thirty-two — half a pixel at 16px,
 * which is all a mark this small can spare and still fill its tab slot.
 */
const PADDING = 4;

/**
 * Ground corner radius. `--radius` is 0.25rem for UI chrome; as a share of a
 * 32-unit box that reads as this — a folio corner, not a pill. DESIGN §2:
 * "sharp, document-like".
 */
const GROUND_RADIUS = 4;

/** A glyph placed on the mark's baseline, with the pen offset it was set at. */
export type PlacedGlyph = {
  readonly d: string;
  /** Pen x in font units — the glyph's path data is drawn shifted by this. */
  readonly penX: number;
};

/** `t·`, set as one line: the dot follows the `t` at DESIGN §3's tracking. */
const SETTING: readonly PlacedGlyph[] = [
  { d: T.d, penX: 0 },
  { d: PERIODCENTERED.d, penX: T.advance + TRACKING },
];

/**
 * Maps font units onto the icon box: `(x, y) → (scale·x + dx, dy − scale·y)`.
 * The y flip is the whole reason this is computed rather than eyeballed —
 * fonts draw up, SVG draws down.
 */
export type MarkTransform = {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
};

/**
 * Fit the setting's ink bounds into the padded box, centred horizontally and
 * vertically. Derived rather than hard-coded so that changing the padding, the
 * tracking, or a glyph cannot silently leave the mark off-centre.
 */
export function markTransform(): MarkTransform {
  const inkLeft = T.bounds[0];
  const inkRight = SETTING[1].penX + PERIODCENTERED.bounds[2];
  const inkBottom = T.bounds[1];
  const inkTop = T.bounds[3];

  const inkWidth = inkRight - inkLeft;
  const inkHeight = inkTop - inkBottom;
  const box = VIEWBOX - 2 * PADDING;

  // The `t` is taller than the pair is wide, so height is the binding
  // dimension; `min` keeps that true if the geometry ever changes.
  const scale = Math.min(box / inkWidth, box / inkHeight);

  return {
    scale,
    dx: (VIEWBOX - inkWidth * scale) / 2 - inkLeft * scale,
    dy: (VIEWBOX + inkHeight * scale) / 2 + inkBottom * scale,
  };
}

/** The rounded ground, as path data in icon units. */
export function groundPath(): string {
  const s = VIEWBOX;
  const r = GROUND_RADIUS;
  // Quadratic corners: a quarter circle is off by ~0.3% of the radius at this
  // size, and Q is the only curve the rasteriser has to understand.
  return (
    `M${r} 0H${s - r}Q${s} 0 ${s} ${r}` +
    `V${s - r}Q${s} ${s} ${s - r} ${s}` +
    `H${r}Q0 ${s} 0 ${s - r}` +
    `V${r}Q0 0 ${r} 0Z`
  );
}

/** The `t·` ink, as path data in icon units — the ground's counterpart. */
export function inkPaths(): readonly string[] {
  const { scale, dx, dy } = markTransform();
  return SETTING.map(({ d, penX }) =>
    transformPath(d, (x, y) => [(x + penX) * scale + dx, dy - y * scale]),
  );
}

/** Colours for one theme. Both come from `globals.css`, never from memory. */
export type MarkPalette = {
  /** `--background`: paper in light, ink ground in dark. */
  readonly ground: string;
  /** `--primary`: the wordmark's red — the only colour DESIGN §4 allows here. */
  readonly ink: string;
};

/**
 * The mark as a standalone SVG document.
 *
 * Both palettes ship in one file because an SVG icon cannot read the app's
 * CSS variables: `prefers-color-scheme` inside the document is the only way a
 * tab icon follows the theme the way DESIGN §1 says both themes are
 * first-class. `favicon.ico` has no such escape hatch and ships light only.
 */
export function markSvg(light: MarkPalette, dark: MarkPalette): string {
  const ink = inkPaths()
    .map((d) => `    <path d="${d}" />`)
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${VIEWBOX}" height="${VIEWBOX}">
  <style>
    .ground { fill: ${light.ground} }
    .ink { fill: ${light.ink} }
    @media (prefers-color-scheme: dark) {
      .ground { fill: ${dark.ground} }
      .ink { fill: ${dark.ink} }
    }
  </style>
  <path class="ground" d="${groundPath()}" />
  <g class="ink">
${ink}
  </g>
</svg>
`;
}

/** Round to a tenth of an icon unit — under a thousandth of a pixel at 16px. */
const round = (n: number) => String(Math.round(n * 10) / 10);

/** One absolute path command and its numbers, as `pathCommands` yields them. */
export type PathCommand = {
  readonly command: "M" | "L" | "H" | "V" | "Q" | "Z";
  readonly args: number[];
};

/**
 * Split absolute `M/L/H/V/Q/Z` path data into its commands.
 *
 * That is the whole alphabet the mark uses: `SVGPathPen` emits nothing else
 * for a quadratic (TrueType) outline, and `groundPath` is written to match. It
 * is a contract two readers depend on — `transformPath` below and the
 * rasteriser's `flatten` in `scripts/generate-icons.ts` — so they share this
 * one tokeniser rather than agreeing by coincidence.
 */
export function* pathCommands(d: string): Generator<PathCommand> {
  for (const [, command, rawArgs] of d.matchAll(/([MLHVQZ])([^MLHVQZ]*)/g)) {
    const trimmed = rawArgs.trim();
    yield {
      command: command as PathCommand["command"],
      args: trimmed ? trimmed.split(/[\s,]+/).map(Number) : [],
    };
  }
}

/**
 * Rewrite absolute path data through a point mapping — the step that carries a
 * glyph out of font space (y-up, 1000/em) into the icon box (y-down, 32 units).
 */
export function transformPath(
  d: string,
  map: (x: number, y: number) => [number, number],
): string {
  let cursor: [number, number] = [0, 0];
  const out: string[] = [];

  for (const { command, args } of pathCommands(d)) {
    if (command === "Z") {
      out.push("Z");
      continue;
    }

    // H and V are absolute, so the missing ordinate is the cursor's — which is
    // exactly the value the mapping needs, since a horizontal line in font
    // space is still horizontal after a scale-and-flip but its endpoint has to
    // be mapped as a full point.
    const points: [number, number][] = [];
    if (command === "H") {
      for (const x of args) points.push([x, cursor[1]]);
    } else if (command === "V") {
      for (const y of args) points.push([cursor[0], y]);
    } else {
      for (let i = 0; i < args.length; i += 2)
        points.push([args[i], args[i + 1]]);
    }
    if (points.length === 0) continue;

    cursor = points[points.length - 1];
    const mapped = points.map(([x, y]) => map(x, y));
    const letter = command === "H" || command === "V" ? "L" : command;
    out.push(
      letter + mapped.map(([x, y]) => `${round(x)} ${round(y)}`).join(" "),
    );
  }

  return out.join("");
}
