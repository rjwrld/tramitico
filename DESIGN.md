# DESIGN.md — Tramitico

> Visual contract for the MVP build. Direction: **Notaría moderna** — chosen from eight studies
> (artifact: "Tramitico — Direction studies", direction F). Ink, folios, and the sello, executed
> with dev-tool precision. Seed version, written pre-build; refresh tokens against real code after
> Week 2 UI work. Strategic context in [PRODUCT.md](PRODUCT.md); scope in [SPEC.md](SPEC.md).

## 1. Theme

Both themes ship first-class. Light is the notary's desk in daylight: true white paper, dark ink,
sello red. Dark is the same desk at 9pm: deep ink-blue-black ground, warm-red stamp. Neither is an
inversion — each is tuned independently. Theme follows system preference, with a manual toggle.

## 2. Color

Strategy: **restrained with one owned accent**. Neutrals are cool ink-tinted grays; the sello red
carries the identity and is *policed* — it marks exactly four things: the `tico` syllable in the
wordmark, citations (sellos), the primary action, and active/focus states. Everything else is ink
on paper. If red appears anywhere else, it's a bug.

### shadcn tokens

```css
:root {
  --background: oklch(1 0 0);                 /* paper white */
  --foreground: oklch(0.24 0.015 285);        /* ink */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.24 0.015 285);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.24 0.015 285);
  --primary: oklch(0.50 0.155 27);            /* sello red */
  --primary-foreground: oklch(0.98 0.005 40);
  --secondary: oklch(0.965 0.004 40);         /* folio — warm-tinted toward the brand hue */
  --secondary-foreground: oklch(0.30 0.015 285);
  --muted: oklch(0.965 0.004 40);
  --muted-foreground: oklch(0.50 0.015 285);
  --accent: oklch(0.965 0.004 40);
  --accent-foreground: oklch(0.30 0.015 285);
  --destructive: oklch(0.42 0.16 12);         /* crimson — see "red discipline" below */
  --border: oklch(0.895 0.005 285);
  --input: oklch(0.895 0.005 285);
  --ring: oklch(0.50 0.155 27);
  --radius: 0.25rem;                          /* sharp, document-like */

  /* Tramitico-specific */
  --sello: oklch(0.50 0.155 27);              /* citation ink */
  --sello-bg: oklch(0.975 0.012 25);          /* citation ground */
  --sello-border: oklch(0.83 0.055 25);       /* citation double-rule */
  --success: oklch(0.52 0.12 155);
  --warning: oklch(0.70 0.13 75);
}

.dark {
  --background: oklch(0.21 0.012 285);        /* ink ground */
  --foreground: oklch(0.90 0.008 285);
  --card: oklch(0.25 0.013 285);
  --card-foreground: oklch(0.90 0.008 285);
  --popover: oklch(0.25 0.013 285);
  --popover-foreground: oklch(0.90 0.008 285);
  --primary: oklch(0.66 0.14 25);             /* warm sello on dark */
  --primary-foreground: oklch(0.18 0.03 25);
  --secondary: oklch(0.27 0.013 285);
  --secondary-foreground: oklch(0.85 0.01 285);
  --muted: oklch(0.27 0.013 285);
  --muted-foreground: oklch(0.66 0.012 285);
  --accent: oklch(0.27 0.013 285);
  --accent-foreground: oklch(0.85 0.01 285);
  --destructive: oklch(0.60 0.17 15);
  --border: oklch(0.32 0.012 285);
  --input: oklch(0.32 0.012 285);
  --ring: oklch(0.66 0.14 25);

  --sello: oklch(0.70 0.13 25);
  --sello-bg: oklch(0.25 0.03 20);
  --sello-border: oklch(0.42 0.07 22);
  --success: oklch(0.70 0.12 155);
  --warning: oklch(0.78 0.13 80);
}
```

**Red discipline.** Brand red and destructive red share a family by necessity. Disambiguation is
structural, not chromatic: destructive actions are always a filled button with an explicit verb
("Eliminar historial") inside a confirm step; the sello/brand red never fills a button except the
single primary action ("Enviar"). Success/warning use their own hues and never lean on red.

**Contrast floors (AA):** body text ≥4.5:1 in both themes (ink on white 14.9:1; foreground on dark
ground ≈11:1). Sello red on white ≈6.3:1 — valid for text. Muted foreground stays ≥4.6:1. Never
lighten body text for elegance.

## 3. Typography

Three voices, paired on a contrast axis:

| Role | Face | Usage |
|---|---|---|
| **La ley** (display/brand) | **Source Serif 4** (weights 500–600) | Wordmark, page titles, empty-state headlines. The bookish authority of legal text. Never for UI controls. |
| **La interfaz** (body/UI) | **Geist Sans** (400/500) | Everything interactive and all answer prose. Two weights only. |
| **El expediente** (data) | **Geist Mono** (400/500) | Citations, artículo references, dates, amounts, metadata. `font-variant-numeric: tabular-nums` wherever digits align. |

Scale (rem): 0.6875 (11px, sello/meta) · 0.75 · 0.875 (UI default) · 1 (answer prose) · 1.25 ·
1.5 · 2 (page title, serif). Answer prose: `line-height 1.7`, measure capped at 68ch. Headings get
`text-wrap: balance`; long answers `text-wrap: pretty`. Display letter-spacing never tighter than
−0.02em.

## 4. Name treatment

Wordmark set in Source Serif 4, lowercase: `trami` in foreground ink, `tico` in sello red. No
logo mark in MVP — the wordmark is the mark. The favicon is a minimal "t·" in the sello style
(red on paper / warm-red on ink). Never a flag, never a mascot.

## 5. The sello (citation chip) — signature component

The most crafted object in the product. Anatomy:

- Geist Mono, 11px, weight 500, uppercase, `letter-spacing: 0.03em`.
- Text: `Reglamento IVA · Art. 11` (doc short-name · artículo). Color `--sello`.
- Ground `--sello-bg`; **double rule**: 1px solid `--sello-border` outer + inset ring
  (`box-shadow: inset 0 0 0 3px var(--sello-bg), inset 0 0 0 4px var(--sello-border)`).
- Radius 3px. Padding 5px 9px.
- Interaction: hover raises border to full `--sello` and underlines nothing (the chip IS the
  link); click opens the official source at the cited artículo. Focus-visible: `--ring` outline.
- Entrance: the *stamp settle* — `scale(1.06) → 1` with opacity 0→1, 180ms ease-out-quart, as each
  citation streams in. Under `prefers-reduced-motion`: instant appearance, no transform.

Everything else on screen defers to it: answers are quiet ink prose; the sellos are where the eye
lands.

## 6. Components (shadcn + AI Elements)

- **Base**: shadcn/ui defaults restyled only through the tokens above — no per-component forks.
- **Chat scaffolding**: Vercel AI Elements; its sources primitive is re-skinned as the sello row.
- **Answer block**: card-free — answers sit directly on the ground, separated by whitespace and a
  hairline `--border` rule. The disclaimer is one italic line, `--muted-foreground`, 12px, below
  the sello row: *No es asesoría legal ni contable — verifique con Hacienda.*
- **User message**: filled `--foreground` on light (paper inverts to ink), `--secondary` on dark;
  radius 0.25rem. Square-cornered restraint, no bubbles-with-tails.
- **Seeded prompts**: bordered chips (`--border`, ground `--secondary`), full radius allowed here
  (pill) — they are actions, not documents.
- **Buttons**: default variant = outline (hairline + ink text). Exactly one filled primary per
  view ("Enviar"). Destructive per red-discipline rule.
- **Empty state**: serif headline ("¿Qué trámite le quita el sueño?"), seeded prompts below —
  invitation, not apology.

## 7. Layout & spacing

Single-column chat, `max-width: 44rem`, centered; history sidebar (signed-in) collapses first.
Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px — vary rhythm deliberately (answers get 24–32px
breathing room; metadata clusters tighten to 4–8px). Flexbox by default; grid only for genuinely
2D regions. Z-index scale: dropdown 10 · sticky 20 · backdrop 30 · modal 40 · toast 50.

## 8. Motion

Restrained and fast — precision, not theater. Durations 120–200ms, ease-out-quart. The motion
budget is spent on exactly three moments:

1. **Stamp settle** on citations (§5) — the signature.
2. **Streaming text** — native token flow, no skeleton shimmer.
3. **Theme toggle** — 150ms crossfade on ground colors only.

No scroll-triggered reveals, no staggered section entrances, no bounce. Every animation has a
`prefers-reduced-motion` alternative (instant or crossfade).

## 9. Voice & copy

- **Answers and UI in Spanish, usted.** App chrome available in English (EN shell); answers never
  translate.
- Sentence case everywhere; no exclamation marks in system copy; contractions natural in EN chrome.
- Buttons: verb first ("Enviar", "Iniciar sesión", "Ver fuente").
- Errors: what happened + what to do, no apology theater ("No se pudo conectar. Intente de nuevo.").
- Rate-limit message: friendly, names the reset time, nudges sign-in — never scolds.
- The disclaimer is always present, always quiet, never a modal.

## 10. Slop guards (checked at review)

No gradients on text or grounds · no glassmorphism · no side-stripe accent borders · no card
grids of icon+heading+text · no uppercase tracked eyebrows as section scaffolding · no hero
metrics · cards only where a true container is needed (the answer block is not a card) · red only
in its four sanctioned places.
