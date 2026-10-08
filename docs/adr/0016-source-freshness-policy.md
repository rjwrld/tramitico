# ADR 0016 — Source freshness policy

Date: 2026-09-04 · Status: accepted · Amends [SPEC §3, §9](../../SPEC.md) · Context:
issues [#254](https://github.com/rjwrld/tramitico/issues/254),
[#262](https://github.com/rjwrld/tramitico/issues/262), and
[#265](https://github.com/rjwrld/tramitico/issues/265)

## Context

A successful fetch proves availability, not vigencia. Annual brackets, minimum wages, contribution
scales, and salary-base figures can remain retrievable after a new fiscal-period source supersedes
them; an answer grounded in that stale text would still pass a conventional citation check.

## Decision

`effective_date` records when a source's rule or figure takes effect and is mandatory for every
source carrying a figure or deadline; it is distinct from `fetched_at`, which records observation.
The manifest marks period-bound sources with `annualChurn`. Those sources must be re-verified for
each fiscal period and must belong to the current period before they can satisfy a Tier 1 case.
When a still-current rule took effect in an earlier year, its `effective_date` remains the legal
start date and `verifiedForFiscalYear` records the current annual check; overwriting vigencia with
the check date would publish a false source claim.
Every other source is re-verified inside the existing quarterly re-crawl window, with its vigente
version resolved again rather than inferred from an unchanged URL.

A missing or out-of-window freshness input fails closed: the source cannot make an answer eligible,
and the answer must abstain or route. Citation UI shows the consultation date and, when available,
the effective date so the reader can verify both provenance and currency.

## Consequences

Freshness becomes a release gate rather than a maintenance aspiration. Automated checks must reject
missing `effective_date` values on figure/deadline sources and stale `annualChurn` entries. A
quarterly recrawl does not make an annual figure current unless the fiscal-period check also passes.

## Amendment (2026-10-07, issue [#505](https://github.com/rjwrld/tramitico/issues/505))

**Out-of-window annual sources are dropped at retrieval, not tagged.** Until #505 the policy
above was enforced only by the manifest vigencia test, which turns the unit gate red on
1 January. Production kept serving whatever the database held, so on 1 January 2027 it would
have gone on quoting the 2026 salario base, salarios mínimos and tramos as current; the prompt
carries today's date (#455), but nothing tied a figure's fiscal year to it.

`retrieve()` now drops every chunk whose source is `annualChurn` and does not cover the current
Costa Rican fiscal year, before the citations, `isWeak`, the rerank and the derived-figure pin
read the pool (`src/lib/vigencia.ts`). The alternative was to tag such chunks so the answer
states the figure's year. Dropping was chosen because:

- the paragraph above already says such a source «cannot make an answer eligible»; a tagged
  chunk still grounds the answer;
- a dropped chunk is a guarantee, testable for free on a pinned clock; a tag is an instruction
  the model may not follow, and checking that it does costs paid replays (ADR 0023);
- the corpus is built to answer with the current period's figures (the decision above), so a
  withheld chunk takes away no answer the product promises.

If dropping leaves nothing corroborated, the ask takes the honest decline, which is the
«abstain or route» above. While any annual source is out of period, `retrieve()` asks
`search_chunks` for twice its count and refills the count after the drop: two years of one
series are near-identical text, and the withheld year would otherwise take the other's places.
The drop is by source, so a non-annual source that quotes a year's figure (the consolidated Ley 7092) is outside it; the second amendment below closes that gap. A `retiredDocKeys` entry is dropped the same way, because retiring a
source from the manifest deploys before the ingest that deletes its rows.

An entry covers the fiscal years from its `effective_date` year through `verifiedForFiscalYear`,
or through its own year when it has none. An entry with no year at all covers none. Entries
whose doc_keys differ only by a trailing year form one series (`tramos-renta-2026`,
`tramos-renta-2027`). So next year's source can be ingested in December beside this year's, and
the runtime switches over at Costa Rica midnight on 1 January with no deploy that day. The
vigencia gate now asks that every series cover the current year, rather than that every entry
name it. A free unit test warns, from 1 December, about each series with nothing for the
coming year, and after 1 January about each entry a newer one superseded. The calendar and the owner's
steps are in [runbook §2.2](../runbook.md#22-annual-corpus-churn-novemberjanuary).

## Amendment (2026-10-07, issue [#518](https://github.com/rjwrld/tramitico/issues/518))

**An artículo of a non-annual source that states one year's figures is dropped by artículo, outside
that year.** The first amendment drops whole sources, so it cannot see a source that is not
annual but quotes a year's figures in a few artículos. The inventory, read from the corpus on
2026-10-07 (local stack and production agree; `ley-renta` fetched 2026-10-02):

| Chunk (`doc_key` · artículo)                | Figures                                                                                                                                       | Year                                    | Treatment                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `ley-renta` · Artículo 15 (parts 0 and 1)   | personas jurídicas: renta bruta ceiling and tramos; personas físicas con actividades lucrativas: escala; annual créditos por hijo and cónyuge | 2026, DE 45333-H                        | `yearFigures`                           |
| `ley-renta` · Artículo 33                   | monthly salario tramos                                                                                                                        | 2026, DE 45333-H                        | `yearFigures`                           |
| `ley-renta` · ARTICULO 34                   | monthly créditos por hijo (¢1.710) and cónyuge (¢2.590)                                                                                       | 2026, DE 45333-H                        | `yearFigures`                           |
| `ccss-faq` · the contribution-rate question | the transcribed `av_tv_2026` image: Salud and IVM escalas for TI and AV, with colón bounds                                                    | January 2026                            | `yearFigures`                           |
| `reglamento-renta` · Artículo 23 (part 0)   | ¢106.000.000 renta bruta ceiling for personas jurídicas                                                                                       | an earlier year's, undated              | not listed → `overriddenFigures` (#529) |
| `ley-renta` · ARTICULO 38                   | ¢72.000 cuota libre                                                                                                                           | pre-1995 text                           | not listed → `overriddenFigures` (#529) |
| `ley-renta` · Artículo 59                   | Fonade's ¢15.000.000.000 a year, adjusted by the IPC                                                                                          | none: a 2008 sum the law indexes itself | not listed                              |

The salario base, the salarios mínimos and the BMC appear in non-annual sources only by name (the
CNPT multas as multiples of the salario base, the TI reglamento's art. 6 on the BMC), never as an
amount, so they need nothing here.

**Decision.** Each manifest entry lists such artículos as `yearFigures`, with the `fiscalYear`
their figures belong to and an `evidence` phrase from the text that names it («a partir del 01 de
enero del 2026», «ENERO 2026»). `retrieve()` drops their chunks in every other fiscal year,
before anything reads the pool, exactly as it drops an out-of-period annual source. The rest of
the source keeps grounding answers. Coverage is the one stated year, so a text that moves to next
year's figures in December is withheld until 1 January, like next year's annual source.

It also drops such a chunk whose own text does not carry the declared evidence. An annual source
gets a new doc_key each year, so next year's rows sit beside this year's before the switch. A
listed artículo keeps one doc_key, so the manifest that names its year and the rows that hold
its text deploy at different moments. A year bump has to merge before the production re-crawl
can run, because `scripts/recrawl.sh` crawls only merged `main`. Without the text check, the
deployed manifest would vouch for last year's rows until the re-crawl finished, which is the
window this amendment exists to close. With it, whichever lands first, the declaration and the
text disagree and the chunk is withheld.

The first amendment's reasoning holds at chunk level, and was checked against the other two
options:

- **Drop rather than tag.** These chunks state the same figures as `tramos-renta-2026`, with the
  same «a partir del 01 de enero del 2026». Served in 2027 they would be exactly what the first
  amendment withholds, and a tag would again be an instruction the model might not follow, which
  only paid replays could check (ADR 0023).
- **Drop rather than re-chunk.** Isolating the figures would keep each artículo's rules (art. 15's
  30 % rate for personas jurídicas, the Mipymes reductions, the rule for salary plus an activity)
  in the window between 1 January and the re-crawl. But SINALEVI interleaves the reform notes with
  the figures inside each inciso, so it needs a source-specific splitter, a re-ingest on both
  stacks, and new chunk headings that move the eval targets naming `ley-renta · Artículo 15`. The
  window is a few weeks a year, the new year's `tramos-renta` source carries the figures in it,
  and an ask left with nothing corroborated takes the honest decline.
- **The manifest rather than chunk metadata.** The runtime matches on `(doc_key, articulo)`, which
  every chunk already carries, so the declaration deploys with the code: no migration and no
  re-ingest, here or in production.

Ingestion keeps the declaration honest on the way in: a crawl in which a listed artículo is
gone, or any of its chunks lacks the evidence, fails before anything is written. The year cannot be advanced without
the text, nor the text without the year. A per-PR unit test checks that each listed artículo is in
the committed corpus index under exactly one heading. An artículo still on last year's figures is
a warning, not a gate: unlike an annual series, the owner cannot fix it until SINALEVI or the CCSS
publishes, and the runtime already keeps the figure out of answers.

**SINALEVI's lagging consolidation.** #518 reported that art. 34 still showed the 2025 créditos.
The 2026-10-02 crawl shows DE 45333-H's 2026 amounts, consistent with art. 15's annual credit
(¢20.520 = 12 × ¢1.710), so the lag has closed. Art. 34 stays in the corpus, listed like arts. 15
and 33, and the mechanism answers the question for every later lag: a consolidation that has not
caught up still names the old year, so it is withheld from 1 January, and its year cannot be
advanced until its text is. Dropping art. 34 for good would also drop the rules on who may claim
the credit.

**Not listed, and why.** `reglamento-renta` art. 23 and `ley-renta` art. 38 quote figures that are
stale today, not on a fiscal year's clock: the reglamento's ¢106.000.000 ceiling (and its
100/75/50 Mipymes reduction) predates the law's current art. 15, and art. 38's ¢72.000 predates
art. 33's tramos. Art. 59's Fonade transfer is a sum the law states once and indexes itself; it
names no fiscal year to follow. Declaring a fiscal year for them would be false, and withholding them changes
today's answers, which is a corpus decision outside this amendment. The fourth amendment below
makes that decision for art. 23 and art. 38 (#529).

**The manual check.** Runbook §2.2 no longer asks the owner to check these four artículos by
hand: the test and the runtime cover them. It keeps one manual step, with a query: looking for
artículos that start quoting a year's figure. The per-PR test reads the corpus index, which holds
headings and not text, so it cannot see a re-crawl that adds a figure to an artículo nobody
listed.

## Amendment (2026-10-07, issue [#531](https://github.com/rjwrld/tramitico/issues/531))

**An artículo stating a fact that ends on a day is dropped from the day after.** The first two
amendments follow the fiscal year. A deadline or a transitional window ends on its own day, and
nothing withheld it: the `ccss-faq` answer «estará disponible hasta el día 11 de noviembre del
2026» would have gone on grounding answers that present the condonación as open. The inventory,
read from the corpus on 2026-10-07 (after the #520 re-ingest) with the query in runbook §2.4,
then for every date from 2025 on, numeric or spelled out («dos mil veinticinco»). The local stack
and production hold the same text for the listed chunk and for EDDI-7's:

| Chunk (`doc_key` · artículo)                                         | Dated fact                                                                                                                                               | Day                         | Treatment                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------- |
| `ccss-faq` · the Ley 10.232 condonación question                     | requests to forgive recargos, multas, intereses and medical-service invoices are accepted «hasta el día 11 de noviembre del 2026»                        | 2026-11-11                  | `datedFacts`                |
| `tribu-cr-res-0011-2025` · Artículo 8                                | the chunk carries Transitorio I: EDDI-7 stays up for forms D-110-07, D-120, D-110-08 and D-121 «hasta el 31 de diciembre de 2026» (MH-DGT-RES-0003-2026) | 2026-12-31                  | not listed                  |
| `ccss-escala-ivm` · Artículo 4°, sesión 9570                         | the IVM escala, from 2026-01-01 «hasta el 31 de diciembre del 2028»                                                                                      | 2028-12-31                  | annual source (amendment 1) |
| `reglamento-renta` · TRANSITORIO IV                                  | the stepped tarifa on Banco Popular and cooperative securities: 14 % from 2026-07-01 to 2027-06-30, 15 % after                                           | a schedule, every step      | not listed                  |
| `reglamento-iva` · Transitorios VI, VII, VII bis, IX and X           | the IVA phase-ins of Ley 9635 and the COVID-era turismo and construction reliefs: exentos, then 4 % and 8 %, then the general rate from 2020–2023        | a schedule, every step past | not listed                  |
| `reglamento-renta` · TRANSITORIO I                                   | the transitional renta period from the Ley 9635 reform «hasta el 31 de diciembre de 2020»                                                                | 2020-12-31, past            | not listed                  |
| `ccss-reglamento-ti` · TRANSITORIO V                                 | the 4-year prescripción for independientes who registered by 2025-05-08                                                                                  | 2025-05-08, past            | not listed                  |
| `disposiciones-v44` · Transitorios I and II                          | nine months from 2024-12-01 to adopt v4.4, extensible to 2025-10-06 at most; v4.3's medicine fields from 2025-01-01 until then                           | 2025, past                  | not listed                  |
| `tribu-cr-res-0011-2025` · Preámbulo, Artículo 4, Transitorios II–IV | ATV and EDDI-7 off at 23:45 on 2025-09-25, TRIBU-CR on at 09:00 on 2025-10-06, pagos parciales through ATV until 2025-09-30                              | 2025, past                  | not listed                  |
| `tribu-cr-faq` · Ingreso a la Oficina Virtual (OVI) · 2              | applies to cédulas «con fecha de vencimiento anterior a septiembre de 2026»                                                                              | a condition, not an expiry  | not listed                  |

**Decision.** Each manifest entry lists such artículos as `datedFacts`, with the `lastDay` the
fact holds (Costa Rica time) and an `evidence` phrase from the text that states it («11 de
noviembre del 2026»). `retrieve()` drops their chunks from the next day, and drops one whose
text no longer carries the evidence, in the same pass and for the same reasons as a
`yearFigures` artículo. For each fact past its day, `retrieve()` asks `search_chunks` for one
more row and refills the count after the drop. Doubling is for the near-identical years of a
series, and a dated fact is one chunk. Ingestion refuses a crawl in which a listed artículo is
gone or lacks its evidence. The declaration deploys with the code; no row changes, here or in production.

**Drop rather than tag**, as in the first two amendments, and for one more reason. A tag would
ask the model to say the date has passed. But the condonación answer holds nothing except the
deadline, and the corpus cannot say what happens after it: the question's own wording, «sus
ampliaciones», shows the window has been extended before. «It has passed» could itself be false
on the day the CCSS extends it. The honest decline that a pool with nothing corroborated takes
sends the reader to the CCSS, which knows.

**Listed: a window the chunk leaves open.** The condonación answer states the window and nothing
else: not what follows it, nor anything still current. From 12 November it would be a closed
window that reads as an open one. Every other dated passage either says what applies once its day
has passed, or carries text that is still current, so withholding it would drop accurate text:

- `tribu-cr-res-0011-2025` Artículo 8, the one other fact still ahead (EDDI-7's forms, through
  2026-12-31), goes on to say that after that date the system «dejará de funcionar».
  The same chunk is the resolution's vigencia and records the 2025 switch to TRIBU-CR, which is
  current. The answer prompt carries today's date (#455), so the text reads as a closed window.
- `ccss-reglamento-ti` Transitorio V is still the rule for those who registered in time.
- Transitorio II of the TRIBU-CR resolution also keeps the ATV's comprobante check up «de forma
  indefinida», which is current.
- The rest record a completed switch whose result the same chunk states: v4.4 in force, TRIBU-CR
  active.

Withholding them would change today's answers, a corpus decision outside this amendment, as in
the second. If a live answer presents one as open, listing it is a manifest line, with no code.
`reglamento-renta` Transitorio IV and `reglamento-iva`'s phase-ins state every step of their
schedules, and what applies after the last, so no day makes them false. The
IVM escala is an annual source and already follows the fiscal year.

**Warnings.** The vigencia unit test warns, never fails, from 7 days before each `lastDay`
through 7 days after it: before, to look for an extension while there is time; after, to catch
one published on the day. Then it goes quiet. Unlike a past year's figures, a closed window is
never fixed upstream, so a warning that did not stop would never end. An extension is a manifest
PR that sets `lastDay` and `evidence` to the new day, then a re-crawl. Until both land, the text
and the declaration disagree and the chunk is withheld. A listed answer the publisher takes down
fails the next crawl of its source, and its entry is retired then. The steps are in
[runbook §2.4](../runbook.md#24-dated-facts-531).

## Amendment (2026-10-07, issue [#529](https://github.com/rjwrld/tramitico/issues/529))

**Words a later law has overridden are dropped wherever a chunk still carries them, on any
day.** The second amendment left two artículos alone because their figures are stale now, not on
a fiscal year's clock. Checked against the current law, as SINALEVI consolidates it and the
corpus holds it (`ley-renta` fetched 2026-10-02; the local stack and production hold the same
text for all three chunks):

| Chunk (`doc_key` · artículo · part)  | What it states                                                                                                                                                                            | What the law says now                                                                                                                                                                                                                                                                                                                                                   | Treatment                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `reglamento-renta` · Artículo 23 · 0 | personas jurídicas on the reduced escala up to a renta bruta of ¢106.000.000; new MEIC/MAG micro and small businesses reduce their tax by 100 %, 75 % and 50 % in their first three years | `ley-renta` art. 15. The ceiling is the inciso b) amount Hacienda indexes each year by decree (¢119.174.000 for 2026, DE 45333-H); Ley 10392 did not change it. The reduction is Ley 10392's (2023-11-14): new Mipymes pay 0 % of the tax in years one to three, 25 % in years four and five and 50 % in year six, and those of personas físicas qualify too (inciso c) | `overriddenFigures`, four phrases |
| `reglamento-renta` · Artículo 23 · 1 | the tail of inciso d) (bonos temáticos) and the decree's duty to update art. 15's amounts                                                                                                 | the same                                                                                                                                                                                                                                                                                                                                                                | served                            |
| `ley-renta` · ARTICULO 38 · 0        | the ¢72.000 cuota libre is one only, so a contributor paid by several employers tells them, and they withhold on the total                                                                | art. 33's tramos, set each year by decree, state the non-taxable amount; the ¢72.000 is pre-1995 text. The one-exemption rule stands, and `reglamento-renta` art. 61 states it too                                                                                                                                                                                      | `overriddenFigures`, one phrase   |

A sweep of every chunk for the old amounts and the 100/75 wording found no other copy. Hits
for «setenta y dos mil colones» inside «ochocientos setenta y dos mil colones» (art. 15 and
`tramos-renta-2026`) are why art. 38's phrase carries its «(¢72.000)». No case in
`eval/dataset.jsonl` targets either artículo, and the step catalogue names neither.

**Decision.** Each manifest entry lists the overridden words as `overriddenFigures`: the
artículo, an `evidence` phrase that is the stale text itself, the law that overrode it
(`overriddenBy`), and the figures in prose. `retrieve()` drops every chunk of the artículo that
carries any of its phrases, in the same pass as the first three amendments and before anything
reads the pool. `crossReferencedChunks` goes through the same check. Art. 23 lists the ceiling and
each year of the reduction as its own phrase, so a re-crawl whose chunk boundary splits the list
still withholds every part that states one. Each phrase costs one more
row from `search_chunks`, as a past dated fact does: an upper bound, since art. 23's four
phrases share one chunk today, and five rows on every ask cost nothing in ranking (the RPC's
`match_count` only caps the fused output). The rows are matched on
`(doc_key, articulo)` and the declaration deploys with the code, so nothing changes in the
database, here or in production.

The evidence is read the other way round from the first three lists. A `yearFigures` or
`datedFacts` chunk must carry its evidence to be served. An overridden chunk is served only
while it does not. Two things follow:

- **The rest of the artículo is kept.** Art. 23's second part states nothing overridden, so it
  goes on grounding answers. Withholding by heading would have dropped it too.
- **A corrected text comes back by itself.** If Hacienda reforms the reglamento to match
  Ley 10392, the old words leave the chunk and it is served again, with no manifest change on
  the day. Ingestion still refuses that crawl, «no longer carries», so the owner reads the new
  text before the entry is retired: a figure reworded but still stale would also pass the
  check. It refuses a crawl that lost the heading for the same reason as the other lists, since
  a renamed artículo would let the figure through unlisted (runbook §2.5).

The three options in #529 were weighed as the earlier amendments weighed theirs:

- **Drop rather than tag.** A tag such as «superseded by Ley 10392» is an instruction the model
  may not follow, and only paid replays could check it (ADR 0023). A dropped chunk is a
  guarantee, tested for free against the real manifest. The current figures are in the corpus,
  in `ley-renta` art. 15 and 33 and `tramos-renta-2026`, so the drop takes away no answer the
  product promises.
- **Drop rather than rely on the prompt.** The prompt carries today's date (#455), but nothing
  in a chunk says a later law replaced it, and the reglamento reads as current. Before this
  change, a question about a new small business's rate could retrieve art. 23 next to art. 15
  and present two reductions, or only the old one.
- **Drop rather than re-chunk.** Isolating the overridden sentences would keep the rest of
  art. 23 part 0, which the drop takes with it: the 30 % rate, MEIC/MAG registration, the
  anti-fragmentation power, inciso c) (personas físicas on art. 15's escala) and the start of
  inciso d) (the bonos temáticos credit). But each of those is stated in `ley-renta` art. 15 as
  well, and re-chunking needs a source-specific
  splitter and a re-ingest on both stacks. Art. 38 is one sentence of rule around the figure,
  and art. 61 of the reglamento states the rule without it.

Art. 59's Fonade transfer stays unlisted, as the second amendment says: the law states the sum
once and indexes it itself, so it is not overridden.
