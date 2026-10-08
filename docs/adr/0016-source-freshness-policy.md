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

| Chunk (`doc_key` · artículo)                | Figures                                                                                                                                       | Year                                    | Treatment     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------- |
| `ley-renta` · Artículo 15 (parts 0 and 1)   | personas jurídicas: renta bruta ceiling and tramos; personas físicas con actividades lucrativas: escala; annual créditos por hijo and cónyuge | 2026, DE 45333-H                        | `yearFigures` |
| `ley-renta` · Artículo 33                   | monthly salario tramos                                                                                                                        | 2026, DE 45333-H                        | `yearFigures` |
| `ley-renta` · ARTICULO 34                   | monthly créditos por hijo (¢1.710) and cónyuge (¢2.590)                                                                                       | 2026, DE 45333-H                        | `yearFigures` |
| `ccss-faq` · the contribution-rate question | the transcribed `av_tv_2026` image: Salud and IVM escalas for TI and AV, with colón bounds                                                    | January 2026                            | `yearFigures` |
| `reglamento-renta` · Artículo 23 (part 0)   | ¢106.000.000 renta bruta ceiling for personas jurídicas                                                                                       | an earlier year's, undated              | not listed    |
| `ley-renta` · ARTICULO 38                   | ¢72.000 cuota libre                                                                                                                           | pre-1995 text                           | not listed    |
| `ley-renta` · Artículo 59                   | Fonade's ¢15.000.000.000 a year, adjusted by the IPC                                                                                          | none: a 2008 sum the law indexes itself | not listed    |

The salario base, the salarios mínimos and the BMC appear in non-annual sources only by name (the
CNPT multas as multiples of the salario base, the TI reglamento's art. 6 on the BMC), never as an
amount, so they need nothing here.

**Decision.** Each manifest entry lists such artículos as `yearFigures`, with the `fiscalYear`
their figures belong to and an `evidence` phrase from the text that names it («a partir del 01 de
enero del 2026», «ENERO 2026»). `retrieve()` drops their chunks in every other fiscal year,
before anything reads the pool, exactly as it drops an out-of-period annual source. The rest of
the source keeps grounding answers. Coverage is the one stated year, so a text that moves to next
year's figures in December is withheld until 1 January, like next year's annual source.

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

What keeps the declaration honest is ingestion: a crawl in which a listed artículo is gone, or no
longer carries its evidence, fails before anything is written. The year cannot be advanced without
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
today's answers, which is a corpus decision outside this amendment.

**The manual check.** Runbook §2.2 no longer asks the owner to check these four artículos by
hand: the test and the runtime cover them. It keeps one manual step, with a query: looking for
artículos that start quoting a year's figure. The per-PR test reads the corpus index, which holds
headings and not text, so it cannot see a re-crawl that adds a figure to an artículo nobody
listed.
