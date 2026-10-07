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
«abstain or route» above. A `retiredDocKeys` entry is dropped the same way, because retiring a
source from the manifest deploys before the ingest that deletes its rows.

An entry covers the fiscal years from its `effective_date` year through `verifiedForFiscalYear`,
or through its own year when it has none. An entry with no year at all covers none. Entries
whose doc_keys differ only by a trailing year form one series (`tramos-renta-2026`,
`tramos-renta-2027`). So next year's source can be ingested in December beside this year's, and
the runtime switches over at Costa Rica midnight on 1 January with no deploy that day. The
vigencia gate now asks that every series cover the current year, rather than that every entry
name it. A free unit test warns, from 1 December, about each series with nothing for the
coming year, and after 1 January about each entry left behind. The calendar and the owner's
steps are in [runbook §2.2](../runbook.md#22-annual-corpus-churn-novemberjanuary).
