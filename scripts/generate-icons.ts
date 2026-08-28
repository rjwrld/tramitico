/**
 * Renders DESIGN §4's `t·` sello mark into the two files Next.js serves as the
 * app's icons (issue #217):
 *
 *   src/app/icon.svg    the sharp one, theme-aware via prefers-color-scheme
 *   src/app/favicon.ico 16/32/48px raster, for the places .svg is not accepted
 *
 * Both are committed; this script is how they are re-derived, and
 * `generate-icons.test.ts` fails the unit lane if the committed bytes drift
 * from what it produces — including when a colour token moves in globals.css,
 * since the palette is read from there rather than copied.
 *
 * Next 16 metadata-file conventions (node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/01-metadata/app-icons.md): `favicon.ico`
 * must sit at the top level of `app/` and emits `<link rel="icon" sizes="any">`;
 * an `icon.svg` beside it emits its own `<link rel="icon">`. Shipping both is
 * the intended pairing — browsers that understand SVG take the vector, the
 * rest fall back to the .ico.
 *
 * Run: `pnpm icons`
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  VIEWBOX,
  groundPath,
  inkPaths,
  markSvg,
  pathCommands,
  type MarkPalette,
} from "../src/lib/design/mark";
import { oklchToHex, readThemeTokens } from "../src/lib/design/contrast";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const ICON_SVG = path.join(REPO_ROOT, "src/app/icon.svg");
export const FAVICON_ICO = path.join(REPO_ROOT, "src/app/favicon.ico");

/** The raster sizes Windows/Chrome actually pick between in a tab strip. */
const ICO_SIZES = [16, 32, 48] as const;

/** Sub-samples per pixel per axis. 4×4 = 16 coverage levels — enough that the
 * `t`'s crossbar, barely one pixel tall at 16px, resolves as a grey rule
 * rather than an on/off row. */
const SUPERSAMPLE = 4;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * DESIGN §4's pairing, read out of the stylesheet: the brand red on the
 * theme's own ground.
 *
 * The ink is `--primary`, not `--sello`. §4 calls the mark "a minimal 't·' in
 * the sello style (red on paper / warm-red on ink)" and in the same breath
 * says "the wordmark is the mark" — and the wordmark's `tico` syllable is
 * `text-primary` (`src/app/page.tsx`). The two tokens are the same colour in
 * light; in dark they part, and it is `--primary` whose §2 comment reads "warm
 * sello on dark", §4's own words. So the mark is the wordmark's red, abbreviated.
 *
 * Both tokens are read live, so a change to either reaches the icons through
 * the test rather than being forgotten.
 */
export function palettes(): { light: MarkPalette; dark: MarkPalette } {
  const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
  const read = (selector: ":root" | ".dark"): MarkPalette => {
    const tokens = readThemeTokens(css, selector);
    return {
      ground: oklchToHex(tokens["--background"]),
      ink: oklchToHex(tokens["--primary"]),
    };
  };
  return { light: read(":root"), dark: read(".dark") };
}

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

type Point = readonly [number, number];

/** Segments per quadratic. At 48px a curve spans a few pixels; 12 is flat. */
const CURVE_STEPS = 12;

/**
 * Flatten absolute path data into closed polygons, straightening every
 * quadratic on the way. Shares `pathCommands` with `transformPath` — see the
 * note there on why that command subset is the whole alphabet.
 */
export function flatten(d: string): Point[][] {
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = [0, 0];

  const push = (p: Point) => {
    current.push(p);
    cursor = p;
  };

  for (const { command, args } of pathCommands(d)) {
    switch (command) {
      case "Z":
        if (current.length > 1) polygons.push(current);
        current = [];
        break;
      case "M":
        if (current.length > 1) polygons.push(current);
        current = [];
        for (let i = 0; i < args.length; i += 2) push([args[i], args[i + 1]]);
        break;
      case "L":
        for (let i = 0; i < args.length; i += 2) push([args[i], args[i + 1]]);
        break;
      case "H":
        for (const x of args) push([x, cursor[1]]);
        break;
      case "V":
        for (const y of args) push([cursor[0], y]);
        break;
      case "Q":
        for (let i = 0; i < args.length; i += 4) {
          const [x0, y0] = cursor;
          const [cx, cy, x1, y1] = args.slice(i, i + 4);
          for (let step = 1; step <= CURVE_STEPS; step++) {
            const t = step / CURVE_STEPS;
            const u = 1 - t;
            push([
              u * u * x0 + 2 * u * t * cx + t * t * x1,
              u * u * y0 + 2 * u * t * cy + t * t * y1,
            ]);
          }
        }
        break;
    }
  }
  if (current.length > 1) polygons.push(current);
  return polygons;
}

/**
 * Scanline fill with the nonzero winding rule — TrueType's rule, and the one
 * that keeps the `t`'s crossbar joined to its stem instead of punching a hole
 * where the two contours overlap.
 *
 * Returns one boolean per sample on a `resolution × resolution` grid covering
 * the icon's `VIEWBOX` box.
 */
export function fill(polygons: Point[][], resolution: number): Uint8Array {
  const grid = new Uint8Array(resolution * resolution);
  const unit = VIEWBOX / resolution;

  type Crossing = { x: number; direction: number };

  for (let row = 0; row < resolution; row++) {
    const y = (row + 0.5) * unit;
    const crossings: Crossing[] = [];

    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const [x0, y0] = polygon[i];
        const [x1, y1] = polygon[(i + 1) % polygon.length];
        if (y0 === y1) continue;
        // Half-open in y so a vertex shared by two edges is counted once.
        if (y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
        crossings.push({
          x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0),
          direction: y1 > y0 ? 1 : -1,
        });
      }
    }
    if (crossings.length === 0) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    let next = 0;
    for (let column = 0; column < resolution; column++) {
      const x = (column + 0.5) * unit;
      while (next < crossings.length && crossings[next].x <= x) {
        winding += crossings[next].direction;
        next++;
      }
      if (winding !== 0) grid[row * resolution + column] = 1;
    }
  }
  return grid;
}

/** Straight-alpha BGRA pixels, top-down, for one raster size. */
export function rasterize(size: number, palette: MarkPalette): Uint8Array {
  const resolution = size * SUPERSAMPLE;
  const ground = fill(flatten(groundPath()), resolution);
  const ink = fill(
    inkPaths().flatMap((d) => flatten(d)),
    resolution,
  );

  const groundRgb = hexToRgb(palette.ground);
  const inkRgb = hexToRgb(palette.ink);
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const row = (y * SUPERSAMPLE + sy) * resolution;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const at = row + x * SUPERSAMPLE + sx;
          // Ink wins wherever it lands; outside the ground the sample is
          // transparent and contributes no colour, which is what keeps the
          // rounded corners from picking up a white fringe.
          const colour = ink[at] ? inkRgb : ground[at] ? groundRgb : null;
          if (!colour) continue;
          covered++;
          for (let c = 0; c < 3; c++) sum[c] += colour[c];
        }
      }
      const at = (y * size + x) * 4;
      if (covered === 0) continue;
      // BGRA, straight alpha — the byte order a 32bpp ICO expects.
      pixels[at] = Math.round(sum[2] / covered);
      pixels[at + 1] = Math.round(sum[1] / covered);
      pixels[at + 2] = Math.round(sum[0] / covered);
      pixels[at + 3] = Math.round((covered / samples) * 255);
    }
  }
  return pixels;
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// ICO container
// ---------------------------------------------------------------------------

/**
 * Pack rasters into an .ico. Each image is an uncompressed 32bpp BMP rather
 * than an embedded PNG: PNG-in-ICO is a Vista-era extension and this file has
 * to satisfy the oldest thing that still asks for `/favicon.ico`.
 */
export function encodeIco(
  images: readonly { size: number; pixels: Uint8Array }[],
): Buffer {
  const DIR_ENTRY = 16;
  const DIB_HEADER = 40;

  const bodies = images.map(({ size, pixels }) => {
    // The AND mask is legacy 1bpp transparency, rows padded to 4 bytes. The
    // alpha channel carries the real thing, so it stays zeroed — but parsers
    // still measure the image by it, so it must be present.
    const maskStride = Math.ceil(size / 32) * 4;
    const mask = Buffer.alloc(maskStride * size);

    const header = Buffer.alloc(DIB_HEADER);
    header.writeUInt32LE(DIB_HEADER, 0);
    header.writeInt32LE(size, 4);
    // Doubled: a DIB inside an ICO declares XOR image plus AND mask.
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12); // planes
    header.writeUInt16LE(32, 14); // bits per pixel
    header.writeUInt32LE(0, 16); // BI_RGB, uncompressed
    header.writeUInt32LE(pixels.length + mask.length, 20);

    // BMP rows run bottom-up.
    const rows = Buffer.alloc(pixels.length);
    for (let y = 0; y < size; y++) {
      rows.set(
        pixels.subarray(y * size * 4, (y + 1) * size * 4),
        (size - 1 - y) * size * 4,
      );
    }
    return Buffer.concat([header, rows, mask]);
  });

  const directory = Buffer.alloc(6 + DIR_ENTRY * images.length);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // 1 = icon
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach(({ size }, i) => {
    const at = 6 + i * DIR_ENTRY;
    directory.writeUInt8(size === 256 ? 0 : size, at);
    directory.writeUInt8(size === 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size — none
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(bodies[i].length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += bodies[i].length;
  });

  return Buffer.concat([directory, ...bodies]);
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** The exact bytes each icon file should hold, given the current tokens. */
export function renderIcons(): { svg: string; ico: Buffer } {
  const { light, dark } = palettes();
  return {
    svg: markSvg(light, dark),
    // A .ico carries one image per size and no way to ask which theme is on
    // screen, so it ships DESIGN §4's light pairing — red on paper. The
    // theme-aware half of the contract is icon.svg's job.
    ico: encodeIco(
      ICO_SIZES.map((size) => ({ size, pixels: rasterize(size, light) })),
    ),
  };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { svg, ico } = renderIcons();
  writeFileSync(ICON_SVG, svg);
  writeFileSync(FAVICON_ICO, ico);
  console.log(`wrote ${path.relative(REPO_ROOT, ICON_SVG)} (${svg.length} B)`);
  console.log(
    `wrote ${path.relative(REPO_ROOT, FAVICON_ICO)} (${ico.length} B, ${ICO_SIZES.join("/")}px)`,
  );
}
