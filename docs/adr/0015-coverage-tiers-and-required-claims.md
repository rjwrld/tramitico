# ADR 0015 — Coverage tiers and the required-claim contract

Date: 2026-09-04 · Status: accepted · Amends [SPEC §1, §9](../../SPEC.md) · Context:
issues [#254](https://github.com/rjwrld/tramitico/issues/254) and
[#265](https://github.com/rjwrld/tramitico/issues/265)

## Context

Aggregate groundedness and retrieval scores can stay green while a frequent or consequential
question is answered incompletely. The earlier corpus-derived eval set also made document coverage
look like user coverage: it mostly asked questions in the words of sources already present.

## Decision

Coverage is classified by question family, not document or institution:

- **Tier 1** is the published beta promise. A family must be frequent or consequential,
  generalizable, backed by a current official source, answerable without reconstructing a private
  professional file, and maintainable and evaluable. Every held-out case is individually blocking
  for retrieval, required claims and steps, groundedness, citations, freshness, and correct
  abstention behavior.
- **Tier 2** is adjacent, answerable to the same evidence standard, but not guaranteed publicly.
  It is evaluated in aggregate and may honestly abstain.
- **Out of scope** is deliberately declined and routed; it is not a failed Tier 2 answer.

Each eligible answer must contain the case's material `requiredClaims` and every `requiredStep` for
a procedure. A strong average never hides a red Tier 1 case. Numeric thresholds are fixed only
after the first authorized baseline on the resulting corpus, then ratcheted upward; they are never
guessed before measurement or lowered to admit a regression.

The initial Tier 1 families are: Hacienda registration; CCSS obligation and affiliation;
electronic receipts, their type, CABYS, and retention; IVA for services; income tax for independent
activity; the CCSS contribution and mixed salaried/independent status; CCSS retroactivity and
prescription; closing and deregistration with Hacienda/CCSS; and basic tax sanctions and
consequences. TRIBU-CR is a required procedural channel inside the applicable families, not a
separate knowledge family.

Initial Tier 2 includes input IVA and foreign-service purchases, card withholding, capital goods,
capital income, exchange rates, simplified taxation for eligible businesses, CCSS delinquency and
payment arrangements, suspension/residence cases, pensioners with activity, TRIBU-CR access and
delegation, D-270, payment platforms within the general rule, and prefilled returns. These are
extended coverage, not guaranteed coverage.

## Consequences

The old corpus-derived dataset remains useful as a regression suite, but it cannot substantiate a
coverage claim. A separate demand-derived held-out set owns the beta gate. Adding documents alone
cannot promote a family: Tier 1 status requires the complete evidence, evaluation, and maintenance
contract above.
