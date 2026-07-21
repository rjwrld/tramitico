# ADR 0001 — SINALEVI fetch recipe (live-API revision)

Date: 2026-07-21 · Status: accepted · Context: Week 1 ingestion ([PR #16](https://github.com/rjwrld/tramitico/pull/16))

## Context

The planning-phase recipe (wayfinder ticket #3) read the version count from a hidden
`cantidadVersiones` field on the `Informacion` shell page. Against the live API that field is
always `0` — it is populated client-side. The first ingestion run failed on it.

## Decision

Drop the shell page entirely. The client ([src/lib/ingestion/sinalevi.ts](../../src/lib/ingestion/sinalevi.ts)) uses:

1. `POST /_BuscarVersionNorma` with `numeroVersion=1` — always exists; its ficha card carries
   the total as `"1 de M"`.
2. `POST /_BuscarVersionNorma` with `numeroVersion=M` — returns the **vigente** `idVersionNorma`
   (out-of-range requests return id `0`, which we treat as a loud failure).
3. `POST /_CargarTextoCompleto` with that id — full consolidated text.

Confirmed traps, now encoded in code and tests: legacy SCIJ redirects land on version 1 (for the
Reglamento IVA, v1 = id 116520 — exactly the id in old URLs — while vigente v16 = 148633); a
browser User-Agent is required; POSTs need explicit bodies (411 otherwise).

## TLS

`sinalevi.go.cr` serves an incomplete certificate chain (missing the "GlobalSign RSA OV SSL
CA 2018" intermediate). Per the corpus-viability research rule — never disable verification —
the intermediate was fetched from the leaf certificate's own AIA URL, vendored at
[corpus/certs/globalsign-rsa-ov-ssl-ca-2018.pem](../../corpus/certs/globalsign-rsa-ov-ssl-ca-2018.pem),
and added to the trusted set via a dedicated undici Agent. Verification stays fully on.

## Consequences

- One fewer request per document; no fragile hidden-field parsing.
- If SINALEVI changes the ficha card format ("1 de M"), ingestion fails loudly with a
  "page shape changed" error — by design.
- The vendored intermediate expires with GlobalSign's cert rotation; the quarterly re-crawl
  will surface that as a TLS failure, and the fix is re-fetching the AIA URL.
