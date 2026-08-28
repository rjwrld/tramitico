// The app's icons are DESIGN §4's `t·` sello mark, generated from the design
// tokens by `generate-icons.ts` and committed as bytes (issue #217).
//
// Committed generated files rot in two directions, so this checks both:
// regenerating must reproduce the committed bytes (a token moved in
// globals.css, or the geometry changed, and nobody re-ran the script), and the
// favicon must not be the create-next-app triangle it shipped as for the first
// 217 issues. The scaffold hash below is that exact file, pinned so the
// regression has a name.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FAVICON_ICO,
  ICON_SVG,
  encodeIco,
  flatten,
  palettes,
  renderIcons,
} from "./generate-icons";
import { contrastOf, readThemeTokens } from "../src/lib/design/contrast";
import { VIEWBOX, groundPath, inkPaths } from "../src/lib/design/mark";

const SCAFFOLD_FAVICON_SHA256 =
  "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932";

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

describe("the shipped icons", () => {
  const rendered = renderIcons();

  it("carries the mark, not the create-next-app triangle", () => {
    expect(sha256(readFileSync(FAVICON_ICO))).not.toBe(SCAFFOLD_FAVICON_SHA256);
  });

  it.each([
    ["src/app/icon.svg", ICON_SVG, () => Buffer.from(rendered.svg)],
    ["src/app/favicon.ico", FAVICON_ICO, () => rendered.ico],
  ])("%s matches what the generator produces now", (_name, file, expected) => {
    // Fails after a token or geometry change until `pnpm icons` is re-run.
    expect(sha256(readFileSync(file))).toBe(sha256(expected()));
  });
});

describe("favicon.ico container", () => {
  const ico = readFileSync(FAVICON_ICO);

  it("declares one 32bpp image per tab-strip size", () => {
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);

    const entries = Array.from({ length: count }, (_, i) => {
      const at = 6 + i * 16;
      return {
        size: ico.readUInt8(at),
        bits: ico.readUInt16LE(at + 6),
        bytes: ico.readUInt32LE(at + 8),
        offset: ico.readUInt32LE(at + 12),
      };
    });

    expect(entries.map((e) => e.size)).toEqual([16, 32, 48]);
    for (const entry of entries) {
      expect(entry.bits).toBe(32);
      // Every declared image lies wholly inside the file — the check that a
      // hand-rolled container most needs.
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(ico.length);
      // 40-byte DIB header, doubled height for the legacy AND mask.
      const header = entry.offset;
      expect(ico.readUInt32LE(header)).toBe(40);
      expect(ico.readInt32LE(header + 4)).toBe(entry.size);
      expect(ico.readInt32LE(header + 8)).toBe(entry.size * 2);
      expect(ico.readUInt32LE(header + 16)).toBe(0); // uncompressed
    }
  });

  it("rounds its corners and fills its middle", () => {
    // Read the 32px image back out of the container: the top-left pixel sits
    // outside the rounded ground and must be transparent, the centre is on the
    // mark's stem and must be opaque.
    const offset = ico.readUInt32LE(6 + 1 * 16 + 12);
    const size = 32;
    const pixels = offset + 40;
    // BMP rows run bottom-up, so row 0 of the image is the last row of data.
    const at = (x: number, y: number) =>
      pixels + ((size - 1 - y) * size + x) * 4;

    expect(ico.readUInt8(at(0, 0) + 3)).toBe(0);
    expect(ico.readUInt8(at(size / 2, size / 2) + 3)).toBe(255);
  });
});

describe("the mark's geometry", () => {
  it("keeps the ink inside the icon box", () => {
    const points = [...inkPaths(), groundPath()].flatMap((d) =>
      flatten(d).flat(),
    );
    expect(points.length).toBeGreaterThan(0);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(VIEWBOX);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VIEWBOX);
    }
  });

  it("sets both glyphs of `t·`", () => {
    expect(inkPaths()).toHaveLength(2);
  });
});

describe("the mark's palette", () => {
  const css = readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );

  it.each(["light", "dark"] as const)(
    "%s: the mark reads against its own ground",
    (theme) => {
      const tokens = readThemeTokens(
        css,
        theme === "light" ? ":root" : ".dark",
      );
      // A 16px glyph is text for legibility purposes, so it clears DESIGN §2's
      // AA text floor rather than the 3:1 non-text one.
      expect(
        contrastOf(tokens["--primary"], tokens["--background"]),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("takes both palettes from the stylesheet, not from a copy", () => {
    const { light, dark } = palettes();
    expect(light.ground).not.toBe(dark.ground);
    expect(light.ink).not.toBe(dark.ink);
    for (const colour of [light.ground, light.ink, dark.ground, dark.ink]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("renders the ink in the brand red the tokens name", () => {
    expect(renderIcons().svg).toContain(palettes().light.ink);
  });
});

describe("encodeIco", () => {
  it("refuses nothing it can round-trip: offsets follow the directory", () => {
    const one = { size: 16, pixels: new Uint8Array(16 * 16 * 4) };
    const ico = encodeIco([
      one,
      { ...one, size: 32, pixels: new Uint8Array(32 * 32 * 4) },
    ]);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 2 * 16);
    expect(ico.readUInt32LE(6 + 16 + 12)).toBe(
      6 + 2 * 16 + ico.readUInt32LE(6 + 8),
    );
  });
});
