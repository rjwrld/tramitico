# Corpus Feasibility — Official CR Sources for a Tax/Trámite RAG Assistant

> Research conducted July 2026 (wayfinder charting session). Verdict: **viable — a corpus of ~10–14 documents is buildable now.**

## 1. Corpus availability

| Document                                                  | Availability         | Format          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reglamento del Régimen de Tributación Simplificada        | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=98767&strTipM=TC) — Decreto Ejecutivo **43881-H** (consolidated with reform 45209-H). Artículo 1 is a **closed list of 22 eligible activities** (software/professional services absent) and artículo 2 bars anyone carrying on activities outside it; artículo 3 carries the entry thresholds. Replaced the [hacienda.go.cr requisitos PDF](https://www.hacienda.go.cr/docs/RequisitosParaOptarPorElRegimenTributacionSimplificada.pdf) in [#108](https://github.com/rjwrld/tramitico/issues/108): the flyer carried no activity list, extracted as column-interleaved layout noise, and its ≤5-employee figure is superseded by this decree |
| Ley 9635 (Fortalecimiento Finanzas Públicas / IVA)        | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=87720&nValor3=125773&strTipM=TC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Ley del IVA (texto consolidado)                           | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?nValor1=1&nValor2=32526) — redirects to new **sinalevi.go.cr**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Reglamento Ley del IVA                                    | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=88953&nValor3=116520&strTipM=TC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Reglamento al Título IV de Ley 9635                       | Public               | HTML            | [SCIJ](http://www.pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=88641&nValor3=115965&strTipM=TC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| DGT resolution: IVA-exempt export services                | Public               | HTML            | [EY summary](https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-la-dgt-emite-resolucion-sobre-servicios-relacionados), [observador.cr](https://observador.cr/el-iva-y-la-exportacion-de-servicios/) — exemption requires service **consumed entirely outside CR**, not merely billed abroad                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reglamento de Comprobantes Electrónicos (Decreto 44739-H) | Public               | SCIJ full text  | In force                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Disposiciones técnicas v4.4 (MH-DGT-RES-0027-2024)        | Public               | PDF/spec        | Mandatory since 1 Sep 2025                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CABYS catalog                                             | Public               | Excel/web       | [BCCR](https://www.bccr.fi.cr/indicadores-economicos/cat%C3%A1logo-de-bienes-y-servicios) — reference data, needs special handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CCSS Base Mínima Contributiva                             | Public               | SCIJ + CCSS     | [SCIJ decree](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=87782&nValor3=114491&strTipM=TC); source figures from primary decree, NOT blogs (aggregators disagreed on 2026 numbers). **Carries no rates** — the escala table is a raster image in the SINALEVI payload (#114); kept only for the SM-linked adjustment mechanism                                                                                                                                                                                                                                                                                                                                                                   |
| CCSS escala contributiva — Seguro de Salud                | Public               | PDF (acta)      | Added by #114. [Acta 8999](https://www.ccss.sa.cr/arc/actas/2018/11/8999.pdf) pp. 104–108, artículo 30° — the acta transcribes as text the same table SINALEVI carries as an image: afiliado 2,89–10,69 %, conjunta 12,00 % + 0,25 % Estado como tal. Still vigente; the 2026 adjustment touched IVM only                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CCSS escala contributiva — Seguro de IVM (2026)           | Public               | PDF (zip anexo) | Added by #114. Ficha técnica PE-DAE-1179-2025 inside [acta 9570's anexos](https://www.ccss.sa.cr/arc/actas/2025/files/9570-b1201.zip) (artículo 4°, sesión 2025-12-18): afiliado 4,16–8,42 %, conjunta 9,91 % + 1,75 % Estado como tal = 11,66 % global. Rige 2026-01-01 → 2028-12-31; next escalón 2029                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Salarios mínimos sector privado (Decreto 45303-MTSS)      | Public               | PDF (alcance)   | Added by #114. [La Gaceta 229, Alcance 156](https://www.imprentanacional.go.cr/pub/2025/12/05/ALCA156_05_12_2025.pdf) pp. 165–171. The escalas are denominated in SM, so this decree is what yields the colón BMC: Ocupación No Calificada ¢373.092,30/mes → 0,87 SM = ¢324.590 (IVM), 0,9295 SM = ¢346.789 (SEM). Annual churn                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Ley del Trabajador Independiente (Ley 10.363, 2023)       | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=99349&nValor3=135825&strTipM=TC) — short but high-value: **4-year statute of limitations** on CCSS retroactive collection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tramos de renta 2026 (Decreto 45333-H)                    | Public               | PDF             | [hacienda.go.cr PDF](https://www.hacienda.go.cr/docs/TramosRenta2026.pdf) — exempt ₡6,244,000/yr; 10/15/20/25%                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Reglamento Ley Impuesto sobre la Renta                    | Public               | HTML            | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/normas/nrm_texto_completo.aspx?param2=1&nValor1=1&nValor2=95992&nValor3=128325&nValor4=NO&strTipM=TC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| MTSS content for independents                             | **Thin — by design** | —               | Labor Code mostly doesn't apply to independent workers; encode the _absence_ as a fact, don't force-fit content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Format verdict:** everything material is clean HTML (SCIJ/SINALEVI — ideal for chunking) or text-based PDF. No OCR needed. No paywalls, no logins, no CAPTCHAs.

**Amendment (#114):** one exception to "no OCR needed" — SINALEVI publishes CCSS escala
contributiva acuerdos as raster images, so their tables are unreadable by any text pipeline. The
workaround needs no OCR either: CCSS's own actas de Junta Directiva transcribe the same tables as
text, so the acta is the ingestible primary source and SINALEVI's copy is not. Check for this shape
(`<img>` where a table should be) whenever a fetched doc's key figures go missing.

**Amendment (#150) — the census, completed.** All 21 images in the four unaudited SINALEVI docs
were fetched and looked at (2026-08-25). The verdict holds for tables — #114 remains the only
image-borne _table_ in the corpus — but it does not hold for **formulas**, which is a second shape
of the same defect:

| doc_key             | imgs | what they are                                                             | loses substance                      |
| ------------------- | ---: | ------------------------------------------------------------------------- | ------------------------------------ |
| `disposiciones-v44` |   10 | 8 Word drawing strokes + 2 diagrams of the clave/consecutivo digit layout | no — incisos a)–h) state every range |
| `reglamento-iva`    |    5 | 5 rendered formulas                                                       | **2 of 5**                           |
| `reglamento-renta`  |    3 | 3 rendered formulas (Transitorio I)                                       | **3 of 3** — but spent               |
| `ley-9635`          |    3 | the same 3 formulas, quoted inside this ficha                             | **3 of 3** — but spent               |

Two lessons worth carrying forward:

1. **A rendered formula fails exactly like a rendered table.** The chunk keeps the announcing
   sentence and the legend that follows, and loses only the expression between them — so
   `reglamento-iva` art. 31(4) reads «El ajuste en cada año deberá calcularse utilizando la
   siguiente fórmula: / Donde: "Ca₀" significa…», with no fórmula. That is the #114 signature with
   a different noun.
2. **"Images and no tables" is a weak discriminator.** It is the loudest signal available and it is
   worth logging, but the worst finding here (`reglamento-iva`) sits in a payload with 2 tables and
   would not have tripped it, while `disposiciones-v44`'s 43 tables accompany 10 harmless images.
   Treat the warning as _go look_, never as a verdict.

The recovery route is unchanged and still needs no OCR: **Imprenta Nacional's Gaceta PDFs carry
these formulas as selectable text.** `pdftotext` on
[Alcance 129 (2019-06-11)](https://www.imprentanacional.go.cr/pub/2019/06/11/ALCA129_11_06_2019.pdf)
recovers both of `reglamento-iva`'s losses verbatim. The catch is version skew: an alcance carries
the text _as published_, so it is a safe source only where the vigente wording has not since been
reformed — which is why #150 ingested nothing (see that issue for the per-image evidence).

## 2. Source stability — is mid-2026 turbulent?

**TRIBU-CR timeline:** ATV/TRAVI shutdown began 18 Jul 2025; data cutover 25 Sep 2025; TRIBU-CR launched **6 Oct 2025** at `ovitribucr.hacienda.go.cr`. All declarations now exclusively via TRIBU-CR (Res. MH-DGT-RES-0011-2025). E-invoicing v4.4 mandatory since 1 Sep 2025. Sources: [El Financiero guide](https://www.elfinancierocr.com/lab-de-ideas/educacion-financiera/tribu-cr-esta-es-la-guia-paso-a-paso-con-todo-lo/TAKOTX35QFG7TNLEPHIWJJM3HM/story/), [Hacienda CP-39-2025](https://www.hacienda.go.cr/docs/CP39-2025.pdf), [facturele.com](https://www.facturele.com/2025/10/29/transicion-de-atv-a-tribu-cr/)

**Assessment:** recently-settled, not fully stable. Watch items:

- Stale ATV-era content everywhere (incl. some Hacienda PDFs) — filter/flag by date.
- Prellenado declarations from v4.4 data still shaking out in the 2026 filing cycle.
- **Renta Global y Dual reform (files 22.393/23.760): pending, NOT yet law** as of July 2026 — would restructure the renta section if enacted. [BDO](https://www.bdo.cr/es-cr/publicaciones/2025/la-reforma-al-impuesto-sobre-la-renta-en-costa-rica-proyecto-de-ley-23-760), [La República](https://www.larepublica.net/noticia/proyecto-de-renta-global-dual-que-cambios-propone-en-relacion-con-pagos-a-proveedores-del-exterior)
- BMC and renta brackets update annually by decree → corpus needs per-document effective-date metadata + quarterly re-crawl.

## 3. Licensing / legal

- SCIJ/SINALEVI (run by PGR) states guiding principles of **libre acceso**, publicity, transparency. [SCIJ help](https://pgrweb.go.cr/SCIJ/ayuda/nrm_ayuda_simple.aspx), [PGR SINALEVI](https://www.pgr.go.cr/servicios/sinalevi/)
- Official texts of laws/decrees are standard public-record material (as with CFR/EUR-Lex); reasonably confident, not attorney-verified — one-time confirmation with a CR attorney advisable before commercializing.
- Secondary commentary (EY, BDO, news) is copyrighted — link and cite, don't ingest wholesale; primary legal text is the corpus.

## 4. Practical scrapeability (checked July 2026)

| Domain                        | Result                                                                    | Notes                                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| hacienda.go.cr (+ /docs PDFs) | HTTP 200                                                                  | Stable, direct-linkable                                                      |
| www.ccss.sa.cr                | HTTP 200                                                                  | `www` required                                                               |
| mtss.go.cr                    | HTTP 200                                                                  | Thin content                                                                 |
| ovitribucr.hacienda.go.cr     | HTTP 200                                                                  | New platform                                                                 |
| pgrweb.go.cr/scij             | **403 without browser User-Agent**, 200 with                              | Scraper must set a realistic UA                                              |
| sinalevi.go.cr                | 403 without UA; also a TLS "unable to verify first certificate" seen once | Handle cert issue explicitly — log/alert, never blindly disable verification |

SCIJ document URLs use stable numeric IDs (`nValor2=XXXXX`); domain itself mid-transition pgrweb → sinalevi.

## 4.1 Deep-link audit (issue #134, checked August 2026)

Can a source chip land on the _cited artículo_ instead of the document root?
Answer per source family, verified against the live sites:

| Family                   | Anchor                                                                            | Verdict                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SINALEVI ficha           | `Informacion?param1=<ficha>&param2=<idVersionNorma>&param3=3&param4=<idArticulo>` | **Yes.** `param3=3` is the viewer's artículo mode; the shell writes `param4` into its hidden `idArticulo` input and `MenuNormativa.js` loads that artículo on ready. |
| PDF with a `pages` range | `#page=<first page>`                                                              | **Yes**, to the section (first page of the range we ingest), not the artículo.                                                                                       |
| Whole-file PDF           | —                                                                                 | **No** — no artículo→page map, so a `#page=` would be a guess.                                                                                                       |
| PDF inside a zip         | —                                                                                 | **No** — the browser downloads the zip; no fragment reaches the PDF.                                                                                                 |
| BCCR CABYS catalog       | —                                                                                 | **No** — search UI, no per-code URL.                                                                                                                                 |

The SINALEVI `idArticulo` is opaque (not the artículo number) and `_BuscarArticulo`
answers `param4=-1` for our fichas, so the only mapping is the «Ficha Artículo» rail
appended to the full-text payload: `handleArticuloClick(<numero>, <ficha>, <version>,
<idArticulo>)`. Ingestion harvests it into `documents.source.articulos`
(`articuloAnchors`, `src/lib/ingestion/sinalevi.ts`).

Trap: transitorios reuse the artículo numbering and the rail does not distinguish them
(ficha 99349 labels both «Artículo 2» and its transitorio as «artículo número 2»), so a
number claimed twice is dropped and that artículo keeps the document root. Coverage
measured on the vigente versions in August 2026:

| doc_key                   | anchors / rail entries |
| ------------------------- | ---------------------- |
| ley-iva                   | 44 / 46                |
| reglamento-iva            | 51 / 92                |
| ley-9635                  | 14 / 94                |
| reglamento-titulo-iv-9635 | 30 / 46                |
| reglamento-renta          | 96 / 122               |
| ley-10363                 | 0 / 4                  |
| ccss-bmc                  | 1 / 1                  |
| reglamento-rts            | 18 / 18                |
| reglamento-comprobantes   | 26 / 28                |
| disposiciones-v44         | 10 / 19                |
| dgt-export-servicios      | 3 / 3                  |

`ley-10363` is the degenerate case — every one of its four numbers is claimed by both an
artículo and a transitorio — so it is marked `deepLink: none` in the manifest rather than
promising an anchor that can never resolve.

## 5. Pain validation

- **43% of CCSS-registered independent workers are morosos.** [Primera Línea](https://primeralinea.cr/el-espejismo-de-la-independencia-43-de-morosidad-en-la-ccss/)
- **84.2% of ~557,000 independent workers operate informally.** [abogadotributario.cr](https://abogadotributario.cr/blog/el-costo-de-ser-trabajador-independiente-en-costa-rica/)
- Independents pay up to **19.11% CCSS** vs 10.87% salaried.
- Retroactive CCSS collection is a top formalization deterrent; Ley 10.363's 4-year limit was the legislative response.
- Failure to **desinscribirse** leaves indefinite filing obligations + penalties. [El Financiero](https://www.elfinancierocr.com/pymes/gerencia/es-profesional-independiente-o-tiene-un-pequeno/IKPKO2JUANH7VMNNKNF77C5FUU/story/)
- First-person features: [La Nación](https://www.nacion.com/revista-dominical/trabajadores-independientes-relatan-como-padecen/DBNCOIXCBBEOPARB43CYG7VGCI/story/)
- **Gap:** developer-specific evidence is thin — real discussions live in closed Facebook/WhatsApp groups; a targeted manual pass or small survey would strengthen the export-services angle. (Decision: post-launch peer collection.)

## Top 10 highest-pain questions (evidence-based; seed prompts + eval set)

1. ¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?
2. ¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica? (consumed-abroad nuance)
3. ¿Cuál código CABYS uso para desarrollo de software?
4. ¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?
5. ¿Me pueden cobrar retroactivo si nunca me inscribí en la CCSS? (4-year limit, Ley 10.363)
6. ¿Cómo emito factura electrónica y qué cambió con v4.4 / TRIBU-CR?
7. ¿Qué pasa si dejo de trabajar independiente — desinscripción D-140 y consecuencias de no hacerla?
8. ¿Cómo calculo renta como persona física con actividad lucrativa — aplica la deducción automática del 25%?
9. ¿Régimen simplificado o tradicional siendo programador? (RTS excluye profesionales liberales)
10. ¿Con TRIBU-CR, cambió el procedimiento para declarar/pagar? ¿Dónde entro ahora?

## Top risks

1. Annual decree churn (brackets, BMC) → per-doc effective-date metadata, quarterly refresh.
2. ATV-era staleness in existing content.
3. Renta Global Dual reform (watch item).
4. SCIJ/SINALEVI bot-blocking (UA required).
5. sinalevi.go.cr TLS irregularity.
6. Conflicting secondary-source numbers → primary decrees only for figures.
7. MTSS gap — communicate absence correctly.
8. Thin dev-specific pain evidence → post-launch peer validation.
