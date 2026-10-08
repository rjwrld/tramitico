# ADR 0024 — An artículo the answer set names comes with it

Date: 2026-10-07 · Status: accepted · Amends [SPEC §5](../../SPEC.md#5-retrieval--answer-assembly) ·
Context: issue [#508](https://github.com/rjwrld/tramitico/issues/508), item 2 of
[#490](https://github.com/rjwrld/tramitico/issues/490), map
[#497](https://github.com/rjwrld/tramitico/issues/497); the run in
[`eval/runs/2026-10-07-508/`](../../eval/runs/2026-10-07-508/)

## Context

«¿Cuál va a ser la tasa del IVA en 2027?» put chunks in front of the model that _name_ Ley
IVA art. 10 — art. 30's «la tarifa referida en el artículo 10 de la presente ley», the IVA
reglamento's art. 22 «de acuerdo a lo establecido en el artículo 10 de la Ley» — and not art.
10 itself, where the 13 % is. The model then wrote that art. 10 «no está entre los documentos
provistos», and ≥5 committed transcripts of `ho-abs-iva-2027` say the same.

Retrieval cannot be relied on to carry the artículo. #51 widened the legs to 50 and the rerank
pool to 40 so that art. 10 could reach the pool for the tarifa-general question; with the 2027
wording it is 74th on word match and outside the vector top 50, so the rerank never sees it.
But the chunk that names it is already in the answer set, and the name is a deterministic
signal: reading it takes no model call and no search.

## Decision

**After the cut, the artículos the answer set names in its own instrument are fetched and
appended — one chunk, ahead of the derived-figure inputs.**

1. **What is a reference** (`crossReferences`, `src/lib/answer/cross-references.ts`). An
   «artículo N» or «artículos N, M y P» — numerals with `°`/`º`/`.º`, the ordinals _primero_
   to _décimo_, `bis`/`ter`/`quater`/`quinquies` — read by what follows the number, past any
   subdivision («inciso b)», «párrafo segundo», «apartado B)») and SINALEVI's «(\*)»:
   - «de esta ley», «de la presente ley»: the chunk's law — the document itself, or, in a
     reglamento, the law it regulates (the IVA reglamento writes «ambos de la presente Ley»
     for the Ley IVA);
   - «de este reglamento», «del presente código», «de la presente resolución», or nothing at
     all («el artículo 22.», «referida en el artículo 10,»): the chunk's own document;
   - in a document whose manifest entry declares `regulates`: «de la Ley» — the defined term,
     followed by punctuation or a word that cannot start a law's name — the law by its title
     («de la Ley del Impuesto sobre el Valor Agregado») or by its number («Ley N° 6826»);
   - anything else after «de»/«del» — «de la Ley N.° 4755», «del Código», «de dicha ley»,
     «de la Ley Reguladora del…» — is another instrument and is **not followed**: resolving it
     means guessing which document it is. A range («5 al 9»), a renumbering note («el antiguo
     artículo 72 al actual 87»), a heading carried over from the next artículo («Artículo
     5º—»), the chunk's own artículo and every reference in a preámbulo (its legal basis, in
     lists this reading cannot tell apart) are not followed either.
2. **`regulates`** is a new manifest field, on `reglamento-iva` and its two excerpts (→
   `ley-iva`) and `reglamento-renta` (→ `ley-renta`). This goes past the issue's «same
   doc_key» on purpose: on the answer set the production pipeline now builds for the 2027
   question (eval/runs/2026-10-02-460 and 2026-10-07-502), art. 30 is not in it; the reglamento's
   art. 22 is, and its reference is to the law. A declared link keeps it deterministic — the
   reglamento names the law it regulates, the manifest records which document that is.
3. **Cap: one chunk, a deferred figure first.** The issue allowed two; the probe measured one.
   Each fragment the model reads is one more it can cite wrongly — #304's `pin` appended up
   to three and groundedness fell 71 → 67 on fragments cited in the wrong place
   ([ADR 0020](0020-step-catalogue-legs.md)) — and the second slot filled on 71 of 109
   answer sets without bringing a single expected target. The one slot goes to a reference
   whose clause defers a figure to it («la **tarifa** referida en el artículo 10», «el
   **porcentaje** a que se refiere…»), else to the first reference in the answer set's order,
   then the text's: the rerank's ranking decides. Art. 30 names art. 4 before art. 10; the
   tarifa makes it art. 10. A referenced artículo contributes its first part, the one that
   carries the heading and the rule's opening.
4. **Where.** `pinAnswerSet` (`src/lib/answer/pins.ts`) is the one append path after the cut,
   for the route, the eval lanes and the probes: cross-references first, then
   [ADR 0018](0018-derived-figures-by-code.md)'s derived inputs. Both are judged against the set
   the rerank cut, never against each other's output, so neither chains into the other, and
   an appended chunk's own references are not read. A chunk both want goes in once. A figure
   whose inputs a reference completed still resolves: resolution reads the final set. Both append
   and never replace, so the citation markers of the cut are unchanged, and an appended chunk is
   numbered and cited like any other.
5. **The lookup.** One service-role read of `chunks` joined to `documents`, whenever the set
   names anything (no RPC, no migration — the role already reads both tables, and nothing is
   granted to anyone else). Labels match loosely in SQL (case, accent, «quáter», «8º») and
   exactly in code. A label the document repeats (`reglamento-iva` has two «Artículo 25») is not
   appended: which one was meant would be a guess. A source withheld by
   [ADR 0016](0016-source-freshness-policy.md)'s fiscal-year check (#505) is not fetched. The
   read stops with the ask and after 2 s of its own; a failed or late lookup logs
   `cross-references: lookup failed` and costs the append only: the set the rerank chose is
   still a complete one. Its time is counted in the telemetry's `rerank` stage, where the
   derived pin already ran.
6. **`PIN_CROSS_REFERENCES`**, a mode knob like `PIN_DERIVED_INPUTS`: unset is `on`, `off` is
   the measured baseline, and `pnpm answer-set-probe` carries an arm with it off.

## Measurement

`pnpm answer-set-probe`, the route's configuration against the same reranked orders with
`PIN_CROSS_REFERENCES=off` ([`eval/runs/2026-10-07-508/`](../../eval/runs/2026-10-07-508/),
≈US$1.60 with the lanes below):

- **80 of 109 answer sets grow by one chunk.** The pin is not a rare event: most answer
  sets cite some sibling artículo. The one appended most is `ley-iva · Artículo 10` (14 sets).
- **Expected targets 133 → 136 of 191, Tier 1 62 → 64**: `iva-servicios-extranjero-comprados`
  (art. 30), `ho-trabajitos-por-mi-cuenta` (ley-renta art. 2) and `ho-cliente-espana-lleva-iva`
  (art. 10). Two cases resolve one more derived figure (CNPT art. 79, which art. 78 names); no
  abstention case resolves one.
- **`ho-abs-iva-2027`**, the acceptance: its answer set carries `ley-iva · Artículo 10`, and
  the abstention lane's answer states «La tarifa general del impuesto es del 13% … [10]» with
  that chunk as [10]. Its requirement check (13 % and art. 10, cited, never denied) passes, and
  the lane's false absence claims are 0 of 9.
- Groundedness was read on two IVA rows only (both grounded); the lanes' gates were not run.
  What 80 grown answer sets do to groundedness and Tier 1 is #512's full lanes to measure, and
  `PIN_CROSS_REFERENCES=off` is the lever if they say it costs more than it brings.

## Consequences

- A chunk the rerank never scored can reach the model. It is there because a chunk the rerank
  chose names it, and the model reads it under the same rules and citation invariant as the
  rest; the cost is at most one more fragment per answer and one database read.
- The patterns are Spanish legal drafting, read without a parser. `pnpm cross-reference-census`
  (free) prints every reference the corpus carries and whether the corpus holds its target;
  run it after a change to the patterns or to the corpus.
- A reference to another instrument is not followed, even when the corpus holds it (the
  `cnpt`, `ley-10363`). Following one needs a declared link like `regulates`, written per pair.
- Known limits, each a miss rather than a wrong append:
  - The one slot goes to the first clause that names a figure, not to the right one: a live
    `ho-cliente-espana-lleva-iva` cut held art. 30 («la tarifa referida en el artículo 10») 8th
    and `reglamento-iva` art. 1 («tarifas … artículo 11») 6th, and art. 11 took the slot.
  - Only an artículo's first part is appended; a figure in a later part is not.
  - In the two IVA reglamento excerpts, a bare «artículo N» reads as the excerpt itself, which
    holds one artículo, rather than as `reglamento-iva`.
