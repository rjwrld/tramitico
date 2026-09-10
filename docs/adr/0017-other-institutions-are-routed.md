# ADR 0017 — Other institutions are routed, not covered

Date: 2026-09-04 · Status: accepted · Amends [SPEC §13](../../SPEC.md) · Context:
issues [#254](https://github.com/rjwrld/tramitico/issues/254),
[#264](https://github.com/rjwrld/tramitico/issues/264), and
[#265](https://github.com/rjwrld/tramitico/issues/265)

## Context

An independent worker's journey can touch INS, a municipality, Registro Nacional, professional
associations, banks, MEIC, migration, or MTSS. Covering every institution would turn a closed,
testable Hacienda/CCSS promise into arbitrary government-procedure coverage; a generic decline to
Hacienda would still be unhelpful.

## Decision

These institutions are out of scope for the beta and receive institution-specific routing. One
deterministic table maps a content-free routing category to the institution's verified official
URL. The decline names that institution, but neither the corpus nor the prompt encodes substantive
rules from it. The existing narrow MTSS fact remains until demand evidence justifies replacing it
with cited routing; the product does not ingest the Labor Code for beta.

Promotion to Tier 2 requires both signals confirmed in #254: at least two of the 6–10 direct
validation participants raise the category unprompted, and a content-free decline counter for that
category crosses a threshold agreed after its first month of production data. The counter records
the routing category, never the question text. Quarterly recrawl verifies every routing URL.

## Amendment (2026-09-10, [#285](https://github.com/rjwrld/tramitico/issues/285))

Two questions the abstention set carries — what to charge for a service, and which professional to
hire — have no competent institution at all: no official document fixes either, so routing them to
Hacienda and the CCSS by default sent readers to portals that cannot answer. They get an eleventh
category, `contadores`, whose destination is a person (a professional in accounting or business
advice) and whose verified URL is the Colegio de Contadores Públicos de Costa Rica — the register
of who is colegiado, not a source for an answer. The decline says so in those words and the UI
labels the link «Registro de colegiados», because calling it an official source would contradict
the decline itself. Everything else about the decision above holds: no corpus, no encoded rules,
one table, the same re-crawl.

## Consequences

Routing is useful abstention, not partial coverage. A link or a count does not authorize an answer
about that institution, and a source is added only after the promoted journey meets the same
authority, generalizability, maintenance, and evaluation standard as every Tier 2 family.
