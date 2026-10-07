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
  --radius: 0.25rem; /* sharp, document-like: answers, sellos, cards, buttons */
  --radius-control: 0.75rem; /* a control a hand rests on: the composer */
  --lift: 0 1px 2px oklch(0.24 0.015 285 / 0.06); /* the one lift a floating control gets */

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
  --lift: 0 1px 2px oklch(0 0 0 / 0.3);

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
primary action ("Enviar", the composer's arrow), which is the sello/brand red's exclusive fill. Success/warning use
their own hues and never lean on red.

**Radius: documents sharp, controls softer.** Everything that reads as paper — answers, sellos,
cards, outline buttons — keeps `--radius`. Two controls are rounder on purpose: the composer
(`--radius-control`, 12px), the surface a hand rests on, and the seed pills (full radius), which
are actions, not documents. Nothing else takes either.

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

| Role                       | Face                                 | Usage                                                                                                                                       |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **La ley** (display/brand) | **Source Serif 4** (weights 500–600) | Wordmark, page titles, empty-state headlines, each question in a thread (#478). The bookish authority of legal text. Never for UI controls. |
| **La interfaz** (body/UI)  | **Geist Sans** (400/500)             | Everything interactive and all answer prose. Two weights only.                                                                              |
| **El expediente** (data)   | **Geist Mono** (400/500)             | Citations, artículo references, dates, amounts, metadata. `font-variant-numeric: tabular-nums` wherever digits align.                       |

Scale (rem): 0.6875 (11px, sello/meta) · 0.75 · 0.875 (UI default) · 1 (answer prose) · 1.125 (answer lead-in) · 1.25 ·
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
- Preview (#478): hover (after 400ms) or keyboard focus opens a small popover card with the
  document's full title, norma · artículo and the official host (mono, muted). It adds
  information, never a second click target; touch has no hover, so a tap still just opens the
  source. Off where the page already prints the title beside the stamp (`/acerca`).
- Entrance: the _stamp settle_ — `scale(1.06) → 1` with opacity 0→1, 180ms ease-out-quart, as each
  citation streams in. Under `prefers-reduced-motion`: instant appearance, no transform.

Everything else on screen defers to it: answers are quiet ink prose; the sellos are where the eye
lands.

**Date caption.** Under each stamp, the source's declared vigencia and the date the corpus
consulted it: _vigente desde 1 ene 2026 · consultado el 6
ago 2026_ — Geist Mono 11px, `--muted-foreground`, lowercase, no rule, no link. The stamp's own
anatomy does not change; freshness is a footnote to the source, not part of the source's name. A
document with neither date gets no caption — the slot is never filled with a guess. When every
stamp in a row carries the same caption, it is said once, under the row, rather than repeated
under each stamp.

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
  the sello row: _No es asesoría legal ni contable — verifique con Hacienda._ Beside it, the
  answer's one action: a ghost «Copiar respuesta» that copies the prose with its `[n]` markers,
  the numbered sources with their official URLs, and the disclaimer. A section title in an
  answer (a bold-only line) is a lead-in one step up the scale (1.125rem, 500), not a bold
  sentence.
- **User message — the folio** (#478): each exchange opens with its question as an `h2` in
  Source Serif 4 at 1.25rem/600, left-aligned over its answer, with a hairline `--border` rule
  between exchanges. The same treatment the history view gives a saved question. It replaces
  the ink bubble, which outweighed the answer it asked for; no bubbles, with or without tails.
- **Seeded prompts**: a two-column grid of equal-width hairline pills (one column, at most
  22.5rem, below a 40rem container) — transparent ground, 1px `--border`, full radius, ink text
  at 0.875rem. Each opens with its institution (`HACIENDA` / `CCSS`) in Geist Mono 11px/500,
  uppercase, `--muted-foreground`, in a fixed-width slot set off by a 1px `--border` divider, so
  every divider sits on one vertical; never red. Hover: `--secondary` ground and a border nudged
  toward ink, 150ms. A transparent pill with an institution tag reads as a scoped action, not a
  tag. Four show on every screen size — Hacienda left, CCSS right; a quiet underlined «Ver más
  preguntas (N)» discloses the rest in place, an odd last pill centred under the two columns.
  Nine long pills made a tag cloud, rows (#478) a wall of text, and a centred wrapping row broke
  into 1-1-2-1 lines at in-between widths. A pill shows a short label; the click sends the full
  question, which then heads the exchange, so nothing asked is hidden. The pill's accessible name
  is what it shows (tag + label), never the hidden question.
- **Composer**: one floating box inside the 44rem column — never a full-width docked bar, whose
  rule collided with the history sidebar. The stack under the thread (box, privacy note, and on
  the landing the colophon) sits 12px off the bottom edge, or the device's inset if larger.
  `--card` ground (crossfading with the page on a theme switch), 1px `--border`,
  `--radius-control`, `--lift` only; the field is borderless inside it and the whole box takes
  focus (red-tinted border + soft `--ring` halo). Text 15px, 16px on touch (iOS zooms below
  it). The action is a compact 30px icon button (arrow up; outline square while streaming)
  whose accessible name stays the verb ("Enviar" / "Detener"). The thread fades out above it
  (`scroll-fade-b`, a 24px mask that eases away as the reader reaches the end), no rule; «Ir al
  final» rests on that faded edge, round, on `--card` with the same `--lift`. Under it, the
  privacy note: one centered 11px line carrying both #136 facts and, in the conversation, the
  «Privacidad» link. On the landing the colophon right under it already links the page, so the
  note drops its own rather than say it twice.
- **Colophon**: the standing pages — Acerca · Privacidad · Términos · Código — in Geist Mono 11px,
  muted, middot-separated: the foot of a document, not navigation chrome. It sits under the
  landing composer (gone once the conversation starts) and at the foot of /acerca, /privacidad
  and /terminos. The home header carries a quiet «Acerca» link beside the theme toggle, hidden
  only under 360px, where it would touch the wordmark.
- **Buttons**: default variant = outline (hairline + ink text). Exactly one filled primary per
  view ("Enviar", the composer's arrow). Destructive per red-discipline rule.
- **Empty state**: serif headline ("¿Qué trámite le quita el sueño?"), a still row of sample
  sellos (#478 — the signature is on screen before the first ask), the scope lines — the first
  closing on the linked corpus count, «…citando el artículo de 23 documentos oficiales» — and
  seeded prompts below: invitation, not apology.
- **Hover-revealed controls** (the history row's delete): hover is a desktop affordance, and
  Tailwind's `hover:` never fires where `@media (hover: hover)` is false. Every such control
  also carries `no-hover:` (the `(hover: none)` variant in `globals.css`) and
  `focus-visible:` reveals, so a phone and a keyboard see what a mouse sees.

## 7. Layout & spacing

Single-column chat, `max-width: 44rem`, centered; history sidebar (signed-in) collapses first.
Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px — vary rhythm deliberately (answers get 24–32px
breathing room; metadata clusters tighten to 4–8px). Flexbox by default; grid only for genuinely
2D regions — the seed pills qualify, since their dividers align down the rows as well as across.
Z-index scale: dropdown 10 · sticky 20 · backdrop 30 · modal 40 · toast 50.

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

**Panel transitions** are continuity, not a fourth moment: the history sheet slides in from the
edge it is anchored to with a backdrop fade (200ms in, 150ms out, same ease), and the desktop
sidebar folds to zero width with the same curve, staying mounted but `inert` while closed. A
full-height panel that pops into place reads as a glitch; the slide says where it came from and
where it goes back to. Under `prefers-reduced-motion` the movement drops and the fade remains.

No scroll-triggered reveals, no staggered section entrances, no bounce. Every animation has a
`prefers-reduced-motion` alternative (instant or crossfade) — for moment 2 that means no ring,
static labels, instant text.

## 9. Voice & copy

- **Answers and chrome in Spanish, usted.** Every visible string, `aria-label`, `sr-only` label
  and page title ([ADR 0021](docs/adr/0021-spanish-chrome.md), #215). The English shell this line
  used to promise is retired: it only ever reached screen-reader users, as English controls
  narrated over a Spanish page. README and the demo script stay English — they address
  contributors, not users.
- Sentence case everywhere; no exclamation marks in system copy.
- Buttons: verb first ("Enviar", "Iniciar sesión", "Ver fuente"). An icon-only button carries the
  verb as its accessible name (the composer's arrow is "Enviar", its square "Detener").
- Errors: what happened + what to do, no apology theater ("No se pudo conectar. Intente de nuevo.").
- Rate-limit message: friendly, names the reset time, nudges sign-in — never scolds.
- The disclaimer is always present, always quiet, never a modal.

## 10. Slop guards (checked at review)

No gradients on text or grounds · no glassmorphism · no side-stripe accent borders · no card
grids of icon+heading+text · no uppercase tracked eyebrows as section scaffolding · no hero
metrics · cards only where a true container is needed (the answer block is not a card) · red only
in its four sanctioned places.
