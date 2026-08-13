# ADR 0008 — Answer prose: constrain the model to a three-construct subset, render it with owned code

Date: 2026-08-10 · Status: accepted ·
Context: issue [#76](https://github.com/rjwrld/tramitico/issues/76), sibling of
[ADR 0004](0004-citation-rendering.md) · Streamdown version probed: **2.5.0**

> This ADR was first written against _reconstructed_ answers and reached a different verdict. Real
> answers captured from the production path overturned it — see [§1](#1-what-the-model-actually-emits).
> The record of the reversal is kept deliberately: the first pass is why the census exists.

> **Amended 2026-08-12 (issue [#133](https://github.com/rjwrld/tramitico/issues/133)).** The
> renderer now emits one `<a>`: the inline superscript reference, whose `href` is a same-page
> `#fragment` built from an id the component itself minted (`selloAnchorId`). The decision below
> is unchanged and so is the property it bought — see the amended Consequences bullet: the
> renderer still parses no HTML and still derives no URL from model text. What narrowed is the
> literal claim "no link path exists", which was the _implementation_ of that property, not the
> property. DESIGN §5 carries the visual contract for the reference.

## Context

Answers render as plain text with `whitespace-pre-wrap`
(`src/components/chat/answer-block.tsx`). #76 framed the choice as A (keep plain text, improve
typography with CSS only) vs B (adopt AI Elements' `Response`, i.e. Streamdown), and described
today's output as "readable but typographically dead." The readiness audit had counted plain-text
rendering as a security strength: nothing the model echoes can become markup.

Both framings turned out to rest on an assumption nobody had checked — what the model actually
writes.

## Decision

**Constrain the model to three constructs — `- ` bullets, `**bold**`, and simple pipe tables — and
render exactly those with owned code.** No markdown library, no HTML parsing, no URL handling: the
renderer walks blocks and emits React text nodes, `<ul>/<li>`, `<strong>`, and `<table>`.

Rejected:

- **B (Streamdown/`Response`)** — its defaults open an image-beacon surface, it autolinks the bare
  Hacienda URLs that appear in 64% of answers (colliding with ADR 0004's "links stay the sellos'
  job"), it mangles literal prose mid-stream, and it costs 220 packages. §3–§5.
- **A (CSS only)** — cannot deliver the typography it promises, and does nothing about the literal
  `**` that 72% of answers now show users. §2.

## Evidence

### 1. What the model actually emits

25 dataset questions run through the production answer path — retrieval → Voyage rerank → Sonnet
with `ANSWER_SYSTEM_PROMPT` — against the local Supabase with the corpus ingested, plus one earlier
capture of the renta question (26 generations total):

| Construct     | Answers containing it                       | What a user sees today        |
| ------------- | ------------------------------------------- | ----------------------------- |
| `**bold**`    | **18/25 (72%)**                             | literal `**` asterisks        |
| `- ` bullets  | 17/25 (68%)                                 | flat lines, no list semantics |
| bare URLs     | 16/25 (64%)                                 | inert text — correct today    |
| `##` headings | 2/25 (8%)                                   | literal `##`                  |
| pipe tables   | 0/25 — **1/1** in the earlier renta capture | raw `\| … \| … \|` rows       |

Two findings the issue did not know about:

1. **This is a live defect, not a typography preference.** Nearly three quarters of answers render
   literal asterisks to users right now. #76's premise ("readable but typographically dead")
   understated it.
2. **Tables are rare and non-deterministic.** The same renta question produced a 7-row tramos table
   on one generation and none on the next. That is what makes constraining the prompt viable: we
   are not suppressing a construct the model needs, we are pinning a coin-flip.

### 2. What the three options look like on real answers

Prototype: a throwaway `/dev/answer-preview` route rendering captured answers three ways against
production tokens and fonts, screenshotted with Playwright. The route, the fixtures, the capture
script and the `streamdown` dependency were all removed after capture; only the renderer below is
carried forward.

Questions: the eval canary `iva-clientes-fuera-cr`; `renta-persona-fisica-deduccion` in the
generation that produced the tramos **table** (the hard case); and `factura-electronica-v44`, the
longest answer in the dataset (21 bullets).

| Question               | A — plain text (today)                                                   | B — Streamdown                                                           | C — owned subset                                                         |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| canary (IVA export)    | [A](0008-answer-markdown-rendering/iva-clientes-fuera-cr-A.png)          | [B](0008-answer-markdown-rendering/iva-clientes-fuera-cr-B.png)          | [C](0008-answer-markdown-rendering/iva-clientes-fuera-cr-C.png)          |
| renta (with the table) | [A](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-A.png) | [B](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-B.png) | [C](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-C.png) |
| factura (longest)      | [A](0008-answer-markdown-rendering/factura-electronica-v44-A.png)        | [B](0008-answer-markdown-rendering/factura-electronica-v44-B.png)        | [C](0008-answer-markdown-rendering/factura-electronica-v44-C.png)        |

- **A** shows the defect plainly: `## 2. Tramos aplicables`, `**renta neta**`, and the tramos table
  as raw pipe rows. Whatever else is decided, this cannot stay.
- **B** renders everything correctly and reads like a chat product: large bold headings competing
  with the sellos for the eye, and the Hacienda URL autolinked into an `<a>` — a link in answer
  prose, which ADR 0004 assigned to the sellos. Quieting it means a per-element `components`
  override table, the "per-component fork" DESIGN §6 forbids.
- **C** keeps DESIGN §5's "quiet ink prose": bold as weight rather than asterisks, bullets with a
  proper hanging indent and a marker muted to `--border`, the tramos table in Geist Mono with
  `tabular-nums` per DESIGN §3, and the URL left as inert text for the sello row to carry.

### 3. Streamdown's escaping model — read, then executed

The pipeline is `rehype-raw` → `rehype-sanitize` (GitHub `defaultSchema`, plus `tel` on `href` and
`metastring` on `code`) → `rehype-harden`. Raw HTML in the model's output _is_ parsed; it is the
sanitizer, not the absence of a raw-HTML path, that keeps it safe. The harden defaults, read
straight out of `dist/chunk-*.js` at 2.5.0:

```js
harden: [
  harden,
  {
    allowedImagePrefixes: ["*"],
    allowedLinkPrefixes: ["*"],
    allowedProtocols: ["*"],
    defaultOrigin: undefined,
    allowDataImages: true,
  },
];
```

`allowDataImages: true` does not get a vote in practice: `rehype-sanitize` runs first and
`defaultSchema` restricts `img` `src` to http/https, so a `data:` image is gone before harden sees
it. Hostile-echo probe (jsdom + Testing Library, default `<Streamdown>`, no props):

| Input                                  | Rendered                                                     |     |
| -------------------------------------- | ------------------------------------------------------------ | --- |
| `<script>window.__pwned=1</script>`    | dropped                                                      | ✅  |
| `<img src=x onerror="...">`            | dropped, no `onerror` anywhere in the HTML                   | ✅  |
| `<iframe src="https://evil.example">`  | dropped                                                      | ✅  |
| `[click](javascript:alert(1))`         | `<span title="Blocked URL">click [blocked]</span>`           | ✅  |
| `<a href="javascript:alert(2)">`       | same block treatment, no `<a>` emitted                       | ✅  |
| `![data](data:image/svg+xml;base64,…)` | `[Image blocked: data]`                                      | ✅  |
| `![px](https://evil.example/px.png)`   | **`<img src="https://evil.example/px.png">` — live request** | ❌  |

The classic XSS surface is closed. But `allowedImagePrefixes: ["*"]` means any markdown image URL
the model echoes is fetched by the user's browser — a beacon carrying IP and `Referer`, from a page
where the _question_ is the sensitive data. The readiness audit's F-13 (no CSP headers) means there
is no second line of defence; `img-src 'self'` would contain it. Fixable with explicit props, but
it reframes the cost: B is not "adopt a safe renderer," it is "adopt a renderer whose defaults are
wrong for us, and keep them right across every future minor version."

### 4. Composition with the `[n]` markers (#75)

Completed markers survive markdown fine: `[6][8]`, `[12]`, `[text][1]`, and a `[3]: nota` line all
render as literal text (no definitions exist, so no reference-link resolution fires).

The failure is mid-stream. `messageText()` hands the renderer the accumulated text on every delta,
and "accumulated" ends wherever the stream currently is — so a marker in flight arrives as a bare
`[6` with no closing bracket for #75 to strip. Streamdown's `parseIncompleteMarkdown` completes it:

```
IN : "Está exento del pago [6"
OUT: <p>Está exento del pago <span title="Blocked URL: undefined">6 [blocked]</span></p>
```

Every citation marker would flash a grey "[blocked]" chip mid-stream, once per marker, on every
answer. The same heuristic mutates prose: `"… 2 ** 3 (subrayado y asteriscos)."` came back with a
trailing `**` appended, and `_neto_` became `<em>neto</em>`. Under C, partial text is just partial
text — there are no completion heuristics to fire.

### 5. Cost

`pnpm add streamdown` pulls **220 packages** — mermaid, d3, shiki, katex — for output that is
bullets, bold, and an occasional five-row table. ADR 0004 set the precedent in this exact area: the
AI Elements sources primitive was rejected in favour of owned `sello.tsx` built against our own
types.

## The renderer

Validated in the prototype; column C in the screenshots is its output. It is a **sketch, not the
shipped code** — it references a `TABLE_LINE` it never defines and describes `Table` in prose. The
implementation landed in `src/components/chat/answer-prose.tsx` (issue
[#77](https://github.com/rjwrld/tramitico/issues/77)); read that for what actually runs, and
[§ What shipped differs](#what-shipped-differs) for the two places it deliberately departs from
the sketch below.

```tsx
/** `**bold**` → `<strong>`; everything else stays a text node. */
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/\*\*/).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${key}-${i}`} className="font-medium">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export function AnswerProse({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== "");
  return (
    <div className="max-w-[68ch] text-base leading-[1.7] text-pretty">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.filter((l) => TABLE_LINE.test(l)).length >= 2) {
          return (
            <Table key={i} lines={lines.filter((l) => TABLE_LINE.test(l))} />
          );
        }
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="my-4 list-disc pl-5 marker:text-border">
              {lines.map((l, j) => (
                <li key={j} className="py-0.5 pl-1">
                  {inline(l.slice(2), `${i}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        // A heading is a prompt violation; degrade it quietly rather than show literal hashes.
        if (/^#{1,6} /.test(block)) {
          return (
            <p key={i} className="mt-6 mb-2 font-medium first:mt-0">
              {inline(block.replace(/^#{1,6} /, ""), `${i}`)}
            </p>
          );
        }
        return (
          <p key={i} className="my-4 first:mt-0 last:mb-0">
            {inline(block, `${i}`)}
          </p>
        );
      })}
    </div>
  );
}
```

`Table` splits `|`-delimited rows, drops the `|---|` rule row, and renders `<thead>/<tbody>` with
Geist Mono + `tabular-nums` on the body.

### What shipped differs

Three departures. The first two were made in #77 and both narrow what the sketch does rather than
adding to it — column C's output is unchanged, since the captured answers put every construct in
its own block with balanced delimiters, so neither case fires on them. The third, made in #95,
widens what the sketch does: a live run surfaced a case none of the captured answers exercised.

1. **Blocks are classified per line, not as a whole.** The sketch asks `lines.every(startsWith("- "))`
   and counts table lines across the whole block, so a block that mixes kinds falls through to the
   paragraph branch. On `"Los tramos:\n| Tramo | Tarifa |\n| --- | --- |\n| ¢0 | 0% |"` that drops
   the lead-in sentence (the table branch keeps only the `|` lines), and on
   `"## Requisitos\n- Uno\n- Dos"` it renders literal `- ` markers. The shipped renderer classifies
   each line, merges neighbouring runs of the same kind, and renders each run — so a lead-in or a
   heading sharing a block with the list or table below it still comes out right. A lone `| … |`
   line still needs a neighbour to count as a table.
2. **Only closed `**` pairs bold.** The sketch's `inline()` wraps every odd-indexed part, so a
   single unmatched delimiter carries `font-medium` to the end of the segment — including a run
   still in flight mid-stream. #77's test list rules that out ("an odd number of `**` in a block
   does not swallow the rest of the paragraph"), so the shipped `inline()` leaves an unclosed
   trailing run as plain text. The delimiter is dropped either way; a half-open run reads as prose
   until it closes, rather than weight that spreads and then retracts.
3. **Adjacent bullet runs merge across a blank line, and across a block boundary generally.** The
   model frequently separates bullets with a blank line (issue #95); since blocks split on
   `\n{2,}` before classification, each blank-line-separated bullet became its own block → its own
   run → its own single-item `<ul>` — an extra `my-4` gap between items that should sit in one
   list's rhythm, and "list, 1 item" announced once per bullet instead of "list, N items" once.
   `mergeAdjacentBulletRuns` runs after the per-block pass and collapses any two
   consecutive bullet runs in the flattened sequence into one, regardless of which block either
   came from. This is deliberately more permissive than "a bullet _block_ joins a neighbouring
   bullet block": on `"Intro:\n- Uno\n\n- Dos"`, block 1 is not all-bullets (it has a lead-in
   line), but its trailing bullet run still merges with block 2's — the merge operates on runs,
   not blocks. Only a non-bullet run (text, heading or table) breaks a run of bullets, so bullets
   on either side of an intervening paragraph still render as two lists. This also heals answers
   already persisted with blank-line bullets, not just newly streamed ones. Rule 9 of
   `ANSWER_SYSTEM_PROMPT` also gained a line asking the model not to separate consecutive bullets
   with a blank line in the first place — formatting-only, but per this ADR's Consequences a
   prompt rule-9 change nominally calls for a groundedness re-run; that re-run was not run from
   this change (no local corpus/API access in the fix's environment) and is left to the reviewer's
   judgment.

## Consequences

- **The prompt gains a formatting rule** — bullets, bold and tables permitted; headings, links and
  every other markdown construct forbidden. Per #75 requirement 4 this forces a **groundedness
  re-run** (≥90% gate) before it lands. That is the price of this decision and it is deliberate:
  constraining the model is what keeps the renderer small enough to own.
- **Headings degrade, they don't break.** The prompt forbids them; the renderer still strips a
  stray `#` run to a quiet lead-in, so an 8%-of-the-time slip never shows a user raw hashes.
- **No HTML or image path exists in the render, and no URL is ever derived from model text.** The
  audit's no-injection-surface property is preserved by construction, not by sanitizer
  configuration — no props to keep right, no dependency to track. Since #133 the renderer emits
  one `href`, and it is a same-page fragment it built itself from a marker's digits
  (`selloAnchorId`); marker text cannot reach it, because only the ordinal does.
- **Links out stay the sellos' job** (ADR 0004). Bare URLs in prose render as inert text, as they
  do today; the #133 superscript links _to_ a sello, never past it.
- The screenshot set (~4.7 MB) is the first ADR asset directory in this repo. If this becomes a
  habit, a `.gitattributes`/LFS policy is worth having.

## What would reopen this

- **Tables becoming common.** One in 26 generations is a coin-flip, not a pattern. If corpus work
  makes tabular answers routine, the owned `Table` grows — or the question genuinely reopens, with
  harden's props locked from the first commit.
- **A construct the model insists on** despite the prompt rule, showing up in the census at a rate
  like today's 72% bold. The census script was throwaway and is not committed — reproducing it is
  ~40 lines: read `eval/dataset.jsonl`, and for each case run `retrieve` → `rerankChunks` →
  `streamText` with `ANSWER_SYSTEM_PROMPT` (i.e. `src/app/api/ask/route.ts` minus rate limiting,
  persistence and the stream transport), then count `^#{1,6} `, `\*\*`, `^\s*\|.*\|$` and `^- ` per
  answer. If prompt-format regressions become a recurring question, that script is worth owning
  under `scripts/` rather than rewriting each time.
