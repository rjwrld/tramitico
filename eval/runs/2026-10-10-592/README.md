# Tier 1 requirements against what the corpus carries, 2026-10-10 (#592)

#583 (`../2026-10-09-583/`, cause D) listed Tier 1 requirements whose carrier
is generic, partial or missing. #592 settles them under the owner's rule: a
requirement is rewritten or dropped only once read-only SQL over
`public.chunks`, and a check against `corpus/manifest.json`, shows that **no**
chunk carries it. A partial carrier means rewriting the requirement to what is
carried, not dropping it. A requirement that is carried but not reached stays
as written. The Tier 1 baseline is not touched; it is re-read from the next
full lane, and moving it is the owner's call (ADR 0023).

**Free.** No provider call. The queries are in [`queries.sql`](queries.sql).
They ran on the shared local stack after #597 ingested
`tribu-cr-res-0020-2025` and `tribu-cr-res-0033-2025` (894 chunks, the corpus
the next lane runs on). Row numbers are #554's table (`../2026-10-08-554/`).

## Result

| Requirement                                                                                  | Case(s)                                                                          | Carrier now                                                                                                                       | Decision                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Row 16 step: «Dónde se presenta la declaración hoy y qué pasa si ya venció el plazo.»        | `ho-iva-en-cero-sin-facturar`                                                    | `tribu-cr-res-0033-2025` Art. 1 and 3 (where); `cnpt` 79 and 88 (late)                                                            | **unchanged**: carried since #597                        |
| Row 18 step: «La declaración anual se presenta en TRIBU-CR, la plataforma tributaria.»       | `ho-rebajar-25-sin-facturas`                                                     | `tribu-cr-res-0020-2025` Art. 3                                                                                                   | **unchanged**: carried since #597                        |
| Row 20 claim: «El período del impuesto va del 1 de enero al 31 de diciembre.»                | `ho-minimo-renta-2026`                                                           | `reglamento-renta` Art. 12, word for word                                                                                         | **unchanged**: carried, not reached (#583 D)             |
| «…; el antiguo formulario D-140 ya no existe.»                                               | `desinscripcion-dejar-actividad`, `rb-pill-me-salgo`, `rb-tilde-deje-de-trabajr` | none names the D-140; `tribu-cr-res-0011-2025` Art. 1 carries the old platform (ATV) being disabled                               | **rewritten** to the ATV half                            |
| Row 26 step: «Qué hay que hacer ante la CCSS para quedar registrado en las dos condiciones.» | `ho-tambien-asegurado-por-patrono`                                               | partial: `ccss-reglamento-ti` 7 and 4, `ccss-faq` «¿Dónde me corresponde realizar el trámite de afiliación?»; dual duty in Art. 1 | **rewritten** to the TI affiliation the corpus describes |

«Where do I file renta/IVA», the robustness miss named in #592, is row 18
itself. Wave E's lane lists «TRIBU-CR as the renta channel» among the
**Tier 1** misses (`../2026-10-09-497-wave-e/README.md`), and no robustness
case has a renta or IVA channel requirement.

**The D-codes.** The new resolutions name neither D-101 nor D-104 in their
operative text. RES-0033 mentions D-104 once, in its considerandos, as the form
of the 2019 resolution, and the TRIBU-CR codes 101 and 150 appear only in the
anexos' form-layout images, which are not ingested. No requirement asks for
D-101 or D-104: `ho-rebajar-25-sin-facturas` mentions «D-101» only in its
`notes` (#416: «ningún documento describe los campos del D-101»). The only
D-code inside a requirement was the D-140 clause below.

## Per requirement

### Rows 16 and 18: the channel, carried since #597

Q1 looks for TRIBU-CR beside a renta, utilidades or IVA declaration, a D-code,
or «presentados mediante el sistema». It matches on the chunk body, without
the title header, which names TRIBU-CR on every #597 chunk. Before #597 it
returned 0 rows. Now it returns only the two new documents:
`tribu-cr-res-0020-2025` Art. 3 and Preámbulo ×2, and `tribu-cr-res-0033-2025`
Art. 1, Art. 3 and Preámbulo. The two Artículo 3 chunks:

- RES-0020: «Los formularios de declaración indicados en el artículo 1
  estarán disponible para ser llenados y presentados mediante el sistema
  TRIBU-CR, accesible desde la página web del Ministerio de Hacienda
  www.hacienda.go.cr. Las declaraciones presentadas en otros medios y formatos
  se tendrán por no presentadas…»
- RES-0033: «Los formularios en esta resolución estarán disponibles para ser
  llenados y presentados mediante el sistema TRIBU-CR, accesible desde la
  página web del Ministerio de Hacienda.»

Both requirements stay as written. Whether either chunk now reaches the answer
set is the next lane's question; nothing here measures it. `expected` is
unchanged too (row 18 still lists `tribu-cr-res-0011-2025` Art. 2).

### Row 20: carried, not reached

Q3 (`1 de enero … 31 de diciembre` near «período») returns
`reglamento-renta` Art. 12, «El período fiscal del Impuesto sobre las
Utilidades es de un año, comprendido entre el 1 de enero y el 31 de diciembre
de cada año», and `reglamento-iva` Transitorio V, a 2019 IVA reference period
that doesn't fit. The claim is carried, so it stays; #583 records why it
isn't reached (no catalogue sentence under two pins).

### «El antiguo formulario D-140 ya no existe»: partial, rewritten

Q2, five phrasings:

| Probe                                                     | Rows | Where                                                                                                |
| --------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| `D[ -]?140`                                               |    0 | —                                                                                                    |
| «formulario» within 80 characters of «desinscrip»         |    3 | `tribu-cr-faq` CIH · 24 (the OVi «Declaración de desinscripción» form), OVI · 29, RES-0020 Preámbulo |
| «declaración de desinscripción»                           |    9 | `tribu-cr-faq` RUT · 9, 32, 33, 34, 37, 39, 44, 46, CIH · 24, all the current OVi form               |
| «ya no existe», «dejó de existir», «formulario anterior»… |    4 | RES-0020 and RES-0033 Preámbulos (ATV «no continuará a disposición de los contribuyentes»)           |
| ATV beside «deshabilit» or «desinscrip»                   |   10 | `tribu-cr-res-0011-2025` Art. 1, Preámbulo, Transitorios II–IV; RES-0020 and RES-0033 Preámbulos     |

No chunk names the D-140, so the form clause has no carrier. What the corpus
does carry is that the old channel is gone: `tribu-cr-res-0011-2025`
Art. 1, «se tienen por deshabilitadas las siguientes plataformas digitales
tributarias: … 2. Administración Tributaria Virtual (ATV), …». The claim keeps
its OVi path and swaps the clause:

- before: «…indicando motivo y fecha de cese; el antiguo formulario D-140 ya
  no existe.»
- after: «…indicando motivo y fecha de cese; ATV, la plataforma anterior,
  quedó deshabilitada.»

The same claim is copied verbatim on the case's two robustness variants
(`rb-pill-me-salgo`, `rb-tilde-deje-de-trabajr`), so all three change
together. Each case's `notes` records the change.

### Row 26: partial, rewritten

Q4, three probes over the CCSS documents and `ley-10363`:

| Probe                                                    | Rows | Where                                                                                                                                                                              |
| -------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a patrono or employer inscribing or reporting the worker |    1 | `ccss-faq` «¿Por qué se registran varias facturas…?» (planillas adicionales for unreported salaries; not registration)                                                             |
| both conditions beside a registration verb               |    4 | `ccss-reglamento-ti` Art. 1; `ccss-faq` «¿Sí un trabajador es asegurado por su patrono y además…?»; two seguro voluntario answers                                                  |
| the TI affiliation procedure                             |    8 | `ccss-reglamento-ti` 4 (within 8 días hábiles) and 7 (presencial or electronic, requisitos); `ccss-faq` «¿Dónde me corresponde realizar el trámite de afiliación?», opening hours… |

The corpus carries the duty to contribute in both conditions
(`ccss-reglamento-ti` Art. 1: «La condición de trabajador asalariado … no
exime a la persona de la obligación de cotizar también como trabajador
independiente, cuando ostente ambas condiciones»). It also carries how to
affiliate as a trabajador independiente. No chunk describes a registration of
the two conditions as such, nor anything the worker does for the salaried side.
The step is rewritten to the carried part:

- before: «Qué hay que hacer ante la CCSS para quedar registrado en las dos
  condiciones.»
- after: «Ante la CCSS hay que gestionar la afiliación como trabajador
  independiente, en una sucursal o por los medios electrónicos que la CCSS
  habilite, aunque ya se cotice como asalariado.»

## Not changed here

- `eval/tier1-carriers.json` (#412's diagnostic map) and #554's
  `carriers.json` still name `tribu-cr-res-0011-2025` Art. 2 for rows 16 and 18. Pointing them at the Artículo 3 chunks is a separate read-side change.
- `expected` targets: no case gains RES-0020 or RES-0033. Adding them would
  move the hit-rate and all-targets reads, which is not a requirement review.

## Reproduce

```
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f eval/runs/2026-10-10-592/queries.sql
```

The quoted sentences are excerpts of official public documents of the
Government of Costa Rica (Hacienda, CCSS, SINALEVI), outside the repository's
Apache-2.0 license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
