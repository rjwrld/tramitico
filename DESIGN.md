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
carries the identity and is _policed_ — it marks exactly four things: the `tico` syllable in the
wordmark, citations (sellos), the primary action, and active/focus states. Everything else is ink
on paper. If red appears anywhere else, it's a bug.

### shadcn tokens

```css
:root {
  --background: oklch(1 0 0); /* paper white */
  --foreground: oklch(0.24 0.015 285); /* ink */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.24 0.015 285);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.24 0.015 285);
  --primary: oklch(0.5 0.155 27); /* sello red */
  --primary-foreground: oklch(0.98 0.005 40);
  --primary-hover: oklch(
    0.44 0.15 27
  ); /* CTA hover ground — darker, not paler */
  --secondary: oklch(
    0.965 0.004 40
  ); /* folio — warm-tinted toward the brand hue */
  --secondary-foreground: oklch(0.3 0.015 285);
  --muted: oklch(0.965 0.004 40);
  --muted-foreground: oklch(0.5 0.015 285);
  --accent: oklch(0.965 0.004 40);
  --accent-foreground: oklch(0.3 0.015 285);
  --destructive: oklch(0.42 0.16 12); /* crimson — see "red discipline" below */
  --destructive-bg: oklch(0.94 0.015 5); /* destructive ground */
  --destructive-bg-hover: oklch(0.88 0.03 5);
  --destructive-border: oklch(0.64 0.11 12); /* destructive zone rule */
  --border: oklch(0.895 0.005 285);
  --input: oklch(0.895 0.005 285);
  --ring: oklch(0.5 0.155 27);
  --radius: 0.25rem; /* sharp, document-like */

  /* Tramitico-specific */
  --sello: oklch(0.5 0.155 27); /* citation ink */
  --sello-bg: oklch(0.975 0.012 25); /* citation ground */
  --sello-border: oklch(0.83 0.055 25); /* citation double-rule */
  --success: oklch(0.52 0.12 155);
  --warning: oklch(0.7 0.13 75);
}

.dark {
  --background: oklch(0.21 0.012 285); /* ink ground */
  --foreground: oklch(0.9 0.008 285);
  --card: oklch(0.25 0.013 285);
  --card-foreground: oklch(0.9 0.008 285);
  --popover: oklch(0.25 0.013 285);
  --popover-foreground: oklch(0.9 0.008 285);
  --primary: oklch(0.66 0.14 25); /* warm sello on dark */
  --primary-foreground: oklch(0.18 0.03 25);
  --primary-hover: oklch(0.72 0.13 25); /* the polarity inverts: lighter here */
  --secondary: oklch(0.27 0.013 285);
  --secondary-foreground: oklch(0.85 0.01 285);
  --muted: oklch(0.27 0.013 285);
  --muted-foreground: oklch(0.66 0.012 285);
  --accent: oklch(0.27 0.013 285);
  --accent-foreground: oklch(0.85 0.01 285);
  --destructive: oklch(0.68 0.17 15);
  --destructive-bg: oklch(0.24 0.04 15);
  --destructive-bg-hover: oklch(0.28 0.05 15);
  --destructive-border: oklch(0.57 0.12 15);
  --border: oklch(0.32 0.012 285);
  --input: oklch(0.32 0.012 285);
  --ring: oklch(0.66 0.14 25);

  --sello: oklch(0.7 0.13 25);
  --sello-bg: oklch(0.25 0.03 20);
  --sello-border: oklch(0.42 0.07 22);
  --success: oklch(0.7 0.12 155);
  --warning: oklch(0.78 0.13 80);
}
```

**Red discipline.** Brand red and destructive red share a family by necessity. Disambiguation is
structural, not chromatic: destructive actions are always a tinted destructive surface
(`Button variant="destructive"`: `--destructive-bg` ground, `--destructive` text) with an explicit
verb ("Eliminar historial") inside a confirm step; red never fills a button except the single
primary action ("Enviar"), which is the sello/brand red's exclusive fill. Success/warning use
their own hues and never lean on red.

**Grounds are tokens, never an alpha of their text.** `--destructive-bg` is tuned per theme, the
same way `--sello-bg` is, and for the same reason. A ground written as `bg-destructive/20` inverts
in dark mode — the text is lighter than the page, so every unit of self-tint drags the ground
toward the text and AA becomes unreachable at _any_ token value (issue #160 measured 3.35:1, and
raising `--destructive` to 0.80 still only reached 3.38:1). This applies to any future
text-on-tint pair, not just destructive.

**Borders that carry meaning are tokens too.** `--destructive-border` — the rule around
`ConfirmInline`'s destructive zone — is the same argument for a non-text pair: as
`border-destructive/30` it measured 1.81:1 light / 1.58:1 dark against the surfaces the confirm
lands on, under WCAG 1.4.11's 3:1 floor (issue #165). A border that only decorates may stay an
alpha; one that delineates a zone gets a token and an assertion.

**Contrast floors (AA):** body text ≥4.5:1 in both themes (ink on white 14.9:1; foreground on dark
ground ≈11:1). Sello red on white ≈6.3:1 — valid for text. Muted foreground stays ≥4.6:1. Never
lighten body text for elegance.

These floors are enforced, not just asserted: `src/lib/design/tokens.test.ts` reads the oklch
values straight out of `globals.css` and fails the unit suite on any pair below 4.5:1. Destructive
measures 7.70:1 / 6.36:1 (light, ground and hover) and 5.33:1 / 4.76:1 (dark); destructive text on
a bare `--background` / `--popover` — where `ConfirmInline`'s prompt copy sits — is 5.68:1 / 5.13:1
in dark. Change a token, rerun the test.

**Contrast floor (non-text, WCAG 1.4.11):** UI borders and rules that carry meaning clear 3:1
against the surface behind them, asserted in the same test. `--destructive-border` measures 3.55:1
on white and 3.74:1 / 3.38:1 on the dark page and popover.

## 3. Typography

Three voices, paired on a contrast axis:

| Role                       | Face                                 | Usage                                                                                                                 |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **La ley** (display/brand) | **Source Serif 4** (weights 500–600) | Wordmark, page titles, empty-state headlines. The bookish authority of legal text. Never for UI controls.             |
| **La interfaz** (body/UI)  | **Geist Sans** (400/500)             | Everything interactive and all answer prose. Two weights only.                                                        |
| **El expediente** (data)   | **Geist Mono** (400/500)             | Citations, artículo references, dates, amounts, metadata. `font-variant-numeric: tabular-nums` wherever digits align. |

Scale (rem): 0.6875 (11px, sello/meta) · 0.75 · 0.875 (UI default) · 1 (answer prose) · 1.25 ·
1.5 · 2 (page title, serif). Answer prose: `line-height 1.7`, measure capped at 68ch. Headings get
`text-wrap: balance`; long answers `text-wrap: pretty`. Display letter-spacing never tighter than
−0.02em — that floor is the `--tracking-display` token (`tracking-display`), not Tailwind's
`tracking-tight`, which is −0.025em and undercuts it; `src/lib/design/typography.test.ts` fails the
build on either tighter class (#215).

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
- Entrance: the _stamp settle_ — `scale(1.06) → 1` with opacity 0→1, 180ms ease-out-quart, as each
  citation streams in. Under `prefers-reduced-motion`: instant appearance, no transform.

Everything else on screen defers to it: answers are quiet ink prose; the sellos are where the eye
lands.

**Fetch caption.** Under each stamp, the date the corpus consulted that document: _consultado el 6
ago 2026_ — Geist Mono 11px, `--muted-foreground`, lowercase, no rule, no link. The stamp's own
anatomy does not change; freshness is a footnote to the source, not part of the source's name. A
document with no recorded fetch date gets no caption — the slot is never filled with a guess.

**Inline reference.** A claim carries its source as a superscript numeral at the end of the
clause — Geist Mono, tabular numerals, `--sello`, no underline, hover ground `--sello-bg`.
The numeral is the sello's position in the row below; following it targets that sello, which
takes a `--ring` outline while it is the fragment target. The chip itself never changes: it grows
no number, keeps its own link to the official source, and stays the object the eye lands on. A
reference with no sello behind it is not rendered — there is no such thing as a superscript that
leads nowhere.

## 6. Components (shadcn + AI Elements)

- **Base**: shadcn/ui defaults restyled only through the tokens above — no per-component forks.
- **Chat scaffolding**: Vercel AI Elements; its sources primitive is re-skinned as the sello row.
- **Answer block**: card-free — answers sit directly on the ground, separated by whitespace and a
  hairline `--border` rule. The disclaimer is one italic line, `--muted-foreground`, 12px, below
  the sello row: _No es asesoría legal ni contable — verifique con Hacienda._
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
2. **Answer reveal** (#169/#219) — since #131 the answer is generated, validated, and only then
   sent, so token flow is a **paced replay of a validated answer, not live streaming**: each word
   fades in at 120 palabras/s (200ms fade, catch-up bounded by the schedule), and only when the
   last word lands do the sellos stamp. The wait is this moment's opening — staged labels
   (buscando → redactando → verificando) with the seal-ring (eight dots chasing a sello rim, in
   `--sello`) and label shine, crossfading 150ms between stages. Still no skeleton shimmer.
3. **Theme toggle** — 150ms crossfade on ground colors only.

No scroll-triggered reveals, no staggered section entrances, no bounce. Every animation has a
`prefers-reduced-motion` alternative (instant or crossfade) — for moment 2 that means no ring,
static labels, instant text.

## 9. Voice & copy

- **Answers and chrome in Spanish, usted.** Every visible string, `aria-label`, `sr-only` label
  and page title ([ADR 0013](docs/adr/0013-spanish-chrome.md), #215). The English shell this line
  used to promise is retired: it only ever reached screen-reader users, as English controls
  narrated over a Spanish page. README and the demo script stay English — they address
  contributors, not users.
- Sentence case everywhere; no exclamation marks in system copy.
- Buttons: verb first ("Enviar", "Iniciar sesión", "Ver fuente").
- Errors: what happened + what to do, no apology theater ("No se pudo conectar. Intente de nuevo.").
- Rate-limit message: friendly, names the reset time, nudges sign-in — never scolds.
- The disclaimer is always present, always quiet, never a modal.

## 10. Slop guards (checked at review)

No gradients on text or grounds · no glassmorphism · no side-stripe accent borders · no card
grids of icon+heading+text · no uppercase tracked eyebrows as section scaffolding · no hero
metrics · cards only where a true container is needed (the answer block is not a card) · red only
in its four sanctioned places.
