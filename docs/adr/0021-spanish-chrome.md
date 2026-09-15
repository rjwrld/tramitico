# ADR 0021 — The app chrome is Spanish, everywhere

Date: 2026-08-28 · Status: accepted · Reverses the language line in
[SPEC §8](../../SPEC.md#8-ui), the SPEC §1 Language row and
[DESIGN §9](../../DESIGN.md#9-voice--copy) ·
Context: issue [#215](https://github.com/rjwrld/tramitico/issues/215), triage decision on
[#11](https://github.com/rjwrld/tramitico/issues/11)

## Context

SPEC has said "ES corpus/answers; EN app chrome, README, demo" since #11. The chrome half of that
was never for the user: the reader is a Costa Rican independent developer asking about the
Reglamento del IVA in Spanish and reading an answer in Spanish, and nothing about them wants the
button above it to say "Send". It was for a second audience — a recruiter or reviewer skimming the
deployed app in English.

What actually shipped is a Spanish app with English leaks. Every surface written for a user is in
Spanish (`Enviar`, `Iniciar sesión`, `Eliminar: …`, the seed prompts, the declines, the privacy
page); what stayed English is the three labels nobody chose deliberately — `Toggle theme`,
`Loading`, `Scroll to end/start` — all of them `aria-label`s or `sr-only` text. So the rule's only
observable effect was to make the app read as English **exactly and only to screen-reader users**,
who get a Spanish page narrated with English controls. That is the opposite of the rule's intent.

Naming this at triage forced the choice rather than leaving the leaks to be re-litigated one label
at a time.

## Decision

**The chrome is Spanish. All of it** — visible copy, `aria-label`, `sr-only`, `title`, page
metadata, `<html lang="es">` (which was already true, and was the standing contradiction).

SPEC §8's "chrome/nav/README/demo in English" is amended to Spanish for the app; the SPEC §1
Language row and DESIGN §9's "App chrome available in English (EN shell)" follow — the same rule
lived in both contracts, so both move. **README and the demo script stay English** — they address contributors and
reviewers, not users, and neither is served by the app.

The recruiter-facing English shell is not dead, it is re-scoped: an explicit locale switch is a
product decision with a real cost (a second copy of every string, and a translation of the
disclaimer, which is a legal claim). It moves to the PRODUCT backlog, where it competes with
everything else, instead of living as an unbudgeted line in the build contract.

## Consequences

- **A screen reader now narrates one language.** `Cambiar tema`, `Cargando`, `Ir al final` / `Ir al
inicio`. This is the whole user-visible change; no sighted surface moved.
- **The rule is now checkable by reading, not by taste.** "Is this string in Spanish?" has one
  answer per string. The old rule needed a judgment about whether a given label counted as chrome.
- **Adding a locale later is a migration, not a correction.** Nothing here assumes a single
  language forever; it assumes the fallback is Spanish rather than English, which matches the
  corpus, the model's output and the reader.
- **README, `docs/`, ADRs and commit messages are unaffected.** They were never chrome.
