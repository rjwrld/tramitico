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
