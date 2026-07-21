# Corpus Feasibility — Official CR Sources for a Tax/Trámite RAG Assistant

> Research conducted July 2026 (wayfinder charting session). Verdict: **viable — a corpus of ~10–14 documents is buildable now.**

## 1. Corpus availability

| Document | Availability | Format | Notes |
|---|---|---|---|
| Régimen Tributación Simplificada — requisitos | Public | PDF | [hacienda.go.cr PDF](https://www.hacienda.go.cr/docs/RequisitosParaOptarPorElRegimenTributacionSimplificada.pdf) — **liberal professionals are explicitly excluded from RTS** (common misconception to correct) |
| Ley 9635 (Fortalecimiento Finanzas Públicas / IVA) | Public | HTML | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=87720&nValor3=125773&strTipM=TC) |
| Ley del IVA (texto consolidado) | Public | HTML | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?nValor1=1&nValor2=32526) — redirects to new **sinalevi.go.cr** |
| Reglamento Ley del IVA | Public | HTML | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=88953&nValor3=116520&strTipM=TC) |
| Reglamento al Título IV de Ley 9635 | Public | HTML | [SCIJ](http://www.pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=88641&nValor3=115965&strTipM=TC) |
| DGT resolution: IVA-exempt export services | Public | HTML | [EY summary](https://www.ey.com/es_ce/technical/tax/tax-alerts/costa-rica-la-dgt-emite-resolucion-sobre-servicios-relacionados), [observador.cr](https://observador.cr/el-iva-y-la-exportacion-de-servicios/) — exemption requires service **consumed entirely outside CR**, not merely billed abroad |
| Reglamento de Comprobantes Electrónicos (Decreto 44739-H) | Public | SCIJ full text | In force |
| Disposiciones técnicas v4.4 (MH-DGT-RES-0027-2024) | Public | PDF/spec | Mandatory since 1 Sep 2025 |
| CABYS catalog | Public | Excel/web | [BCCR](https://www.bccr.fi.cr/indicadores-economicos/cat%C3%A1logo-de-bienes-y-servicios) — reference data, needs special handling |
| CCSS Base Mínima Contributiva | Public | SCIJ + CCSS | [SCIJ decree](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=87782&nValor3=114491&strTipM=TC); source figures from primary decree, NOT blogs (aggregators disagreed on 2026 numbers) |
| Ley del Trabajador Independiente (Ley 10.363, 2023) | Public | HTML | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=99349&nValor3=135825&strTipM=TC) — short but high-value: **4-year statute of limitations** on CCSS retroactive collection |
| Tramos de renta 2026 (Decreto 45333-H) | Public | PDF | [hacienda.go.cr PDF](https://www.hacienda.go.cr/docs/TramosRenta2026.pdf) — exempt ₡6,244,000/yr; 10/15/20/25% |
| Reglamento Ley Impuesto sobre la Renta | Public | HTML | [SCIJ](https://pgrweb.go.cr/scij/Busqueda/Normativa/normas/nrm_texto_completo.aspx?param2=1&nValor1=1&nValor2=95992&nValor3=128325&nValor4=NO&strTipM=TC) |
| MTSS content for independents | **Thin — by design** | — | Labor Code mostly doesn't apply to independent workers; encode the *absence* as a fact, don't force-fit content |

**Format verdict:** everything material is clean HTML (SCIJ/SINALEVI — ideal for chunking) or text-based PDF. No OCR needed. No paywalls, no logins, no CAPTCHAs.

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

| Domain | Result | Notes |
|---|---|---|
| hacienda.go.cr (+ /docs PDFs) | HTTP 200 | Stable, direct-linkable |
| www.ccss.sa.cr | HTTP 200 | `www` required |
| mtss.go.cr | HTTP 200 | Thin content |
| ovitribucr.hacienda.go.cr | HTTP 200 | New platform |
| pgrweb.go.cr/scij | **403 without browser User-Agent**, 200 with | Scraper must set a realistic UA |
| sinalevi.go.cr | 403 without UA; also a TLS "unable to verify first certificate" seen once | Handle cert issue explicitly — log/alert, never blindly disable verification |

SCIJ document URLs use stable numeric IDs (`nValor2=XXXXX`); domain itself mid-transition pgrweb → sinalevi.

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
