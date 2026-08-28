# Corpus samples

Three representative documents fetched 2026-07-21 for the chunking prototype
([ticket #4](https://github.com/rjwrld/tramitico/issues/4)). Full fetch story in
[ticket #3](https://github.com/rjwrld/tramitico/issues/3).

| File | Document | Source | Version |
|---|---|---|---|
| `reglamento-iva-vigente.html` | Reglamento de la Ley del IVA (Decreto 41779) | SINALEVI, idFichaNorma 88953 | **16 de 16 (vigente)**, 71 artículos |
| `ley-10363-trabajador-independiente.html` | Ley del Trabajador Independiente (Ley 10.363) | SINALEVI, idFichaNorma 99349 | 1 de 1 |
| `tramos-renta-2026.pdf` | Tramos del Impuesto sobre la Renta 2026 (Decreto 45333-H) | hacienda.go.cr/docs/TramosRenta2026.pdf | 1 page, PDF 1.4 |

The `.html` files are the raw `html` payload from SINALEVI's API — Word-export HTML
(`mso-` styles); a cleaning pass is part of the chunking work.

## SINALEVI fetch recipe (no cookies, no session)

The legacy `pgrweb.go.cr/scij` URLs redirect to `sinalevi.go.cr`, an app shell that
loads legal text client-side. The underlying API is three plain POSTs (browser
User-Agent required — bare curl UA gets 403), per
[ADR 0001](../adr/0001-sinalevi-fetch-recipe.md):

1. `POST /ResultadosNormativa/_BuscarVersionNorma` with `idFichaNorma=<id>&numeroVersion=1`
   → the ficha card for version 1, which always exists; read the total off its
   `"1 de M"` label.
2. `POST /ResultadosNormativa/_BuscarVersionNorma` with `idFichaNorma=<id>&numeroVersion=M`
   → JSON `{ idVersionNorma }` — the **vigente** version id. An out-of-range
   `numeroVersion` returns id `0`, which is a loud failure, not a fallback.
3. `POST /ResultadosNormativa/_CargarTextoCompleto` with `idFichaNorma=<id>&version=<idVersionNorma>&busqueda=`
   → JSON `{ html }` — the full consolidated text.

**Do not** read the version count from the `Informacion` shell page's hidden
`cantidadVersiones` field: against the live API it is always `0` (populated
client-side), and the first ingestion run failed on it — ADR 0001 dropped the
shell page for exactly that reason.

Mapping from old SCIJ URLs: `nValor2` = `idFichaNorma`, `nValor3` = a version id.
**Trap:** the redirected URL lands on the *original* version (1 de N), not the vigente
one — always resolve the vigente id via step 2. POSTs need an explicit body
(empty body without Content-Length → HTTP 411). `sinalevi.go.cr` also serves an
incomplete certificate chain; the vendored intermediate and the undici Agent that
trusts it are ADR 0001's TLS section.

## hacienda.go.cr WAF

`hacienda.go.cr` fronts a WAF that fingerprints the TLS stack: curl fails with an
HTTP 400 interstitial ("su solicitud está en revisión") **regardless of headers or
User-Agent**, while a real browser network stack (Playwright) passes with no cookies
at all. The ingestion pipeline must fetch Hacienda PDFs through Playwright (or a
TLS-impersonating client like curl-impersonate) — plain fetch/curl will never work.
