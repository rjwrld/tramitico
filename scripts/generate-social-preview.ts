/**
 * Renders the repository's social preview (#252) — the 1280×640 card GitHub
 * shows when the repository URL is shared — into `docs/assets/social-preview.png`.
 *
 * GitHub has no API for the social preview: the owner uploads the file by hand
 * in Settings → General → Social preview (scripts/public-release-wizard.sh
 * walks that step). The card is DESIGN §4 on paper: the `t·` mark and the
 * wordmark in the sello red, ink for everything else, and three sellos because
 * the citation chip is the signature component (DESIGN §5). Fonts are the ones
 * the app ships — Source Serif 4 vendored under `src/app/fonts/`, Geist from
 * the `geist` package — and the colours are read from `globals.css` the way
 * `generate-icons.ts` reads them, so a palette change reaches the card by
 * re-running this script rather than by memory.
 *
 * Rasterised with the Playwright Chromium the e2e lane already installs; the
 * PNG is committed and re-derived on demand, not drift-tested — nothing serves
 * it, and Chromium's text rendering is not byte-stable across platforms.
 *
 * Run: `pnpm exec tsx scripts/generate-social-preview.ts`
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { oklchToHex, readThemeTokens } from "../src/lib/design/contrast";
import { markSvg } from "../src/lib/design/mark";
import { palettes } from "./generate-icons";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const SOCIAL_PREVIEW_PNG = path.join(
  REPO_ROOT,
  "docs/assets/social-preview.png",
);

/** GitHub's recommended size; anything smaller is upscaled and blurred. */
const WIDTH = 1280;
const HEIGHT = 640;

function fontDataUri(relative: string): string {
  const file = path.join(REPO_ROOT, relative);
  if (!existsSync(file)) throw new Error(`font not found: ${relative}`);
  return `url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2")`;
}

/** The light theme's tokens, as hex — the card has no dark variant. */
function lightTokens(): Record<string, string> {
  const css = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
  const raw = readThemeTokens(css, ":root");
  const pick = (name: string) => {
    const value = raw[name];
    if (!value) throw new Error(`no ${name} token in globals.css :root`);
    return oklchToHex(value);
  };
  return {
    background: pick("--background"),
    foreground: pick("--foreground"),
    muted: pick("--muted-foreground"),
    border: pick("--border"),
    primary: pick("--primary"),
    sello: pick("--sello"),
    selloBg: pick("--sello-bg"),
    selloBorder: pick("--sello-border"),
  };
}

/** Three real labels, in `selloLabel`'s form: `docShortName(doc_key) · Art. N`. */
const SELLOS = [
  "Ley IVA · Art. 4",
  "Reglamento IVA · Art. 11",
  "Ley 10363 · Art. 3",
];

export function renderHtml(): string {
  const t = lightTokens();
  const { light, dark } = palettes();
  const mark = markSvg(light, dark)
    .replace(/width="\d+" height="\d+"/, 'width="128" height="128"')
    .replace("<svg ", '<svg role="img" aria-label="Tramitico" ');
  const sellos = SELLOS.map(
    (label) => `<span class="sello">${label}</span>`,
  ).join("\n        ");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "Source Serif 4";
    src: ${fontDataUri("src/app/fonts/SourceSerif4-Variable-latin.woff2")};
    font-weight: 200 900;
  }
  @font-face {
    font-family: "Geist";
    src: ${fontDataUri("node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2")};
    font-weight: 100 900;
  }
  @font-face {
    font-family: "Geist Mono";
    src: ${fontDataUri("node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2")};
    font-weight: 100 900;
  }
  html, body { margin: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: ${t.background}; color: ${t.foreground};
    font-family: "Geist", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    box-sizing: border-box; width: 100%; height: 100%;
    padding: 84px 96px 72px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 36px; }
  .brand svg { display: block; flex: none; }
  .wordmark {
    font-family: "Source Serif 4", Georgia, serif;
    font-weight: 600; font-size: 112px; line-height: 1; letter-spacing: -0.01em;
  }
  .wordmark b { font-weight: inherit; color: ${t.primary}; }
  .tagline {
    max-width: 1000px; margin: 0;
    font-size: 34px; line-height: 1.3; font-weight: 400;
  }
  .sellos { display: flex; gap: 14px; }
  .sello {
    display: inline-block; border-radius: 3px; padding: 10px 18px;
    font-family: "Geist Mono", ui-monospace, monospace;
    font-size: 22px; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase;
    color: ${t.sello}; background: ${t.selloBg}; border: 2px solid ${t.selloBorder};
    box-shadow: inset 0 0 0 6px ${t.selloBg}, inset 0 0 0 8px ${t.selloBorder};
  }
  .foot {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-top: 24px; border-top: 2px solid ${t.border};
    font-family: "Geist Mono", ui-monospace, monospace;
    font-size: 20px; color: ${t.muted}; letter-spacing: 0.01em;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      ${mark}
      <div class="wordmark">trami<b>tico</b></div>
    </div>
    <p class="tagline">
      Impuestos y trámites para quien trabaja por cuenta propia en Costa Rica.
      Cada respuesta, sellada a su fuente oficial.
    </p>
    <div class="sellos">
        ${sellos}
    </div>
    <div class="foot">
      <span>tramitico.com</span>
      <span>Hacienda · CCSS · SINALEVI · BCCR</span>
      <span>Apache-2.0</span>
    </div>
  </div>
</body>
</html>
`;
}

export async function renderPng(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    await page.setContent(renderHtml(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await browser.close();
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  renderPng().then((png) => {
    writeFileSync(SOCIAL_PREVIEW_PNG, png);
    console.log(
      `wrote ${path.relative(REPO_ROOT, SOCIAL_PREVIEW_PNG)} (${png.length} B, ${WIDTH}×${HEIGHT})`,
    );
  });
}
