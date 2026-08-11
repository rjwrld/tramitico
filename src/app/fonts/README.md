# Vendored fonts

Source Serif 4 — DESIGN §3's display voice ("la ley") — lives here as a binary so
`pnpm build` never touches the network (issue #83). Geist Sans and Geist Mono need no
vendoring: the [`geist`](https://www.npmjs.com/package/geist) package ships their binaries.

| File                                | Provenance                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SourceSerif4-Variable-latin.woff2` | `@fontsource-variable/source-serif-4@5.3.0` → `files/source-serif-4-latin-wght-normal.woff2`, verbatim |
| `SourceSerif4-LICENSE.txt`          | the same package's `LICENSE` (SIL OFL 1.1, attribution Google Inc.)                                    |

The file is the latin subset with the full `wght` 200–900 axis (`opsz` fixed at its 14 default).
`layout.tsx` declares only `500 600` of that axis — DESIGN §3's range, and what the old Google
loader served — so a stray `font-bold` still clamps to 600 rather than rendering off-spec. Its
unicode range covers U+0000–00FF, so Spanish `¿`, `ñ`, and the accented vowels are all in it.

`src/app/layout.tsx` wraps it with `next/font/local` rather than importing the package's CSS —
the CSS import would lose next/font's preloading and `size-adjust` fallback metrics. To update,
`npm pack` the package at the new version and copy both files across; nothing else references
them.
