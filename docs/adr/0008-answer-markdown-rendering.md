# ADR 0008 — Answer prose: an owned block renderer, not markdown (Streamdown / AI Elements `Response`)

Date: 2026-08-10 · Status: accepted ·
Context: issue [#76](https://github.com/rjwrld/tramitico/issues/76), sibling of
[ADR 0004](0004-citation-rendering.md) · Streamdown version probed: **2.5.0**

## Context

Answers render as plain text with `whitespace-pre-wrap`
(`src/components/chat/answer-block.tsx`). The model emits hyphen-bullet runs that display as flat
lines — readable but typographically dead, and the list semantics are lost to assistive tech.
#76 posed it as A (keep plain text, improve typography with CSS only) vs B (adopt AI Elements'
`Response`, i.e. Streamdown). The audit had counted plain-text rendering as a security strength:
nothing the model echoes can become markup.

## Decision

**Reject option B (Streamdown/`Response`). Ship option C — a ~25-line owned block renderer that
turns `- ` runs into real `<ul>/<li>` and leaves every leaf a React text node.**

C buys the whole reason B was on the table (list semantics for assistive tech, proper hanging
indents, breathing room between blocks) at zero cost to the guarantee the audit banked: there is
no HTML, link, image, or URL path in the render at all, so "nothing the model echoes can become
markup" stays literally true rather than becoming "true modulo a sanitizer's defaults."

Option A (CSS-only) is rejected too. Beyond leaving list semantics flat — the part that actually
matters for screen readers — CSS alone cannot deliver the typography it promises: with the whole
answer in one `whitespace-pre-wrap` text node there is no per-item element to hang an indent from
or to space apart. The moment you emit one element per item to fix that, you have built C.

Build work: separate issue. The rest of this ADR is the evidence.

## Evidence

### 1. What the three options look like

Prototype: a throwaway `/dev/answer-preview` route rendering the same answer text three ways
against production tokens and fonts, screenshotted with Playwright at 2× (light). The route,
the fixtures, and the `streamdown` dependency were removed after capture — nothing from the
prototype is committed except the option-C renderer, reproduced below.

Questions: the two the issue names as producing the longest answers — the eval canary
`iva-clientes-fuera-cr` (ADR 0003's blocking case) and `renta-persona-fisica-deduccion`.

|                        | Canary (IVA export)                                             | Renta calculation                                                        |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A — plain text (today) | [A](0008-answer-markdown-rendering/iva-clientes-fuera-cr-A.png) | [A](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-A.png) |
| B — Streamdown         | [B](0008-answer-markdown-rendering/iva-clientes-fuera-cr-B.png) | [B](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-B.png) |
| C — owned lists        | [C](0008-answer-markdown-rendering/iva-clientes-fuera-cr-C.png) | [C](0008-answer-markdown-rendering/renta-persona-fisica-deduccion-C.png) |

Side-by-side, all six: [`all.png`](0008-answer-markdown-rendering/all.png).

**Caveat on the answer text — read this before trusting the screenshots.** No API keys or
Supabase instance were available in this working copy (`.env.local` absent), so the two answers
are _reconstructed_, not generated: written to the production prompt's observed shape (Spanish
usted, hyphen bullets, per-claim `[n]` markers, one lead paragraph then labelled bullet runs),
with markers already stripped per [#75](https://github.com/rjwrld/tramitico/issues/75). They
exercise the typography faithfully; they are not a groundedness sample. What the pictures settle
is layout mechanics — marker position, wrap alignment, block rhythm — which any long bulleted
answer would show identically. The two disqualifying findings for B (§2, §3) come from executed
code and do not depend on the pictures at all.

What the pictures show:

- **A** is today's state, not the CSS-improved variant the issue proposed — and that is the
  point. Inside one `whitespace-pre-wrap` text node there is no element per item, so CSS has
  nothing to hang an indent off and nothing to put margin between: hyphen runs read as a wall,
  wrapped lines start at the bullet's column, items sit flush against each other. Recovering
  either property means emitting one element per item, which _is_ option C. So the column is
  labelled honestly as the baseline, and option A is rejected on the argument rather than on the
  screenshot: the best version of A is C minus the semantics.
- **B** fixes the wall but ships Streamdown's own list typography: `list-inside`, so a wrapped
  line runs back underneath the marker instead of hanging off it, plus `py-1` per item and a
  full-weight `●`. It reads like a chat product, not like DESIGN §5's "quiet ink prose."
- **C** gets the hanging indent right (`list-disc pl-5`, wrapped lines align under the text) and
  the marker muted to `--border`. Structure without a change of voice.

DESIGN §5's "answers are quiet ink prose" survives _structure_ fine — the sellos are still the
only saturated thing on the page in C. It does not survive B's defaults without a per-element
`components` override table, which is the "per-component fork" DESIGN §6 forbids.

### 2. Streamdown's escaping model — read, then executed

The pipeline is `rehype-raw` → `rehype-sanitize` (GitHub `defaultSchema`, plus `tel` on `href`
and `metastring` on `code`) → `rehype-harden`. Raw HTML in the model's output _is_ parsed; it is
the sanitizer, not the absence of a raw-HTML path, that keeps it safe. The harden defaults, read
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
`defaultSchema` restricts `img` `src` to http/https, so a `data:` image is already gone before
harden sees it — which is why the table below shows data images blocked despite that default.

Executed a hostile-echo probe (jsdom + Testing Library, default `<Streamdown>`, no props).
Results:

| Input                                  | Rendered                                                     |     |
| -------------------------------------- | ------------------------------------------------------------ | --- |
| `<script>window.__pwned=1</script>`    | dropped                                                      | ✅  |
| `<img src=x onerror="...">`            | dropped, no `onerror` anywhere in the HTML                   | ✅  |
| `<iframe src="https://evil.example">`  | dropped                                                      | ✅  |
| `[click](javascript:alert(1))`         | `<span title="Blocked URL">click [blocked]</span>`           | ✅  |
| `<a href="javascript:alert(2)">`       | same block treatment, no `<a>` emitted                       | ✅  |
| `![data](data:image/svg+xml;base64,…)` | `[Image blocked: data]`                                      | ✅  |
| `![px](https://evil.example/px.png)`   | **`<img src="https://evil.example/px.png">` — live request** | ❌  |

So: no script execution, no `javascript:` navigation — the classic XSS surface is closed. But
`allowedImagePrefixes: ["*"]` means **any markdown image URL the model emits is fetched by the
user's browser**. Our corpus is ingested official HTML/PDF; a chunk that contains an image URL,
or a prompt-injection line inside a chunk, becomes a beacon carrying the user's IP and
`Referer` to a third party — from a page where the _question itself_ is the sensitive data. That
is precisely the guarantee the audit counted as a strength, traded away by default.

This is fixable (`allowedImagePrefixes: []`, `allowedLinkPrefixes: []`, `allowedProtocols: []`)
and if B were adopted those props would be mandatory and test-locked. It is recorded here
because it reframes the cost: B is not "adopt a safe renderer," it is "adopt a renderer whose
defaults are wrong for us and stay right across every future minor version."

### 3. Composition with the `[n]` markers (#75) — one hard failure

Markers survive completed markdown fine: `[6][8]`, `[12]`, `[text][1]`, and a `[3]: nota` line
all render as literal text (no definitions exist, so no reference-link resolution fires).

The failure is mid-stream. #75 strips markers from the _rendered_ text, and `messageText()`
hands the renderer the full accumulated text on every delta — but "accumulated" still ends
wherever the stream currently is, so a marker in flight arrives as a bare `[6` with no closing
bracket to strip. Streamdown's `parseIncompleteMarkdown` then completes the dangling syntax:

```
IN : "Está exento del pago [6"
OUT: <p>Está exento del pago <span title="Blocked URL: undefined">6 [blocked]</span></p>
```

Every citation marker would flash a grey "[blocked]" chip during streaming, once per marker, on
every answer. The same heuristic mutates ordinary prose: `"… 2 ** 3 (subrayado y asteriscos)."`
came back with a trailing `**` appended, and `_neto_` became `<em>neto</em>` — our answers quote
legal text with underscores, asterisks and percent signs and are not authored as markdown.

One more incompatibility with DESIGN §6: a block indented four spaces (the model does this when
transcribing a tariff table) renders as a full Shiki code block with Copy and Download buttons.

### 4. Cost

`pnpm add streamdown` pulls **220 packages** — mermaid, d3, shiki, katex — for a renderer that
would be locked down to paragraphs and unordered lists. ADR 0004 already set the precedent in
this exact area: the AI Elements sources primitive was rejected in favour of owned
`sello.tsx` built against our own types. Same reasoning, same conclusion.

## Option C, in full

The renderer the build issue should start from (validated in the prototype; the screenshots in
column C are its output):

```tsx
export function AnswerProse({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== "");
  return (
    <div className="max-w-[68ch] text-base leading-[1.7] text-pretty">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => l.startsWith("- "));
        if (isList) {
          return (
            <ul key={i} className="my-4 list-disc pl-5 marker:text-border">
              {lines.map((line, j) => (
                <li key={j} className="py-0.5 pl-1">
                  {line.slice(2)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-4 first:mt-0 last:mb-0">
            {block}
          </p>
        );
      })}
    </div>
  );
}
```

Notes for the build issue:

- Everything is a text node — React escapes it. No `dangerouslySetInnerHTML`, no URL handling,
  no sanitizer to keep configured. The audit's strength is preserved by construction.
- Streaming is inert: partial text just renders as partial text. A trailing `- ` with no content
  yet is an empty `<li>`, which disappears on the next delta. No completion heuristics.
- The prompt does **not** need to change. The model already emits `- ` runs; C reads what it
  already writes. That means no groundedness re-run is required for the render change itself —
  worth confirming in the build issue, but the prompt edit that would have forced a re-run under
  B is not on the table.
- Ordered lists (`1. `) are deliberately out of scope until an answer needs them.
- Unit-testable as a pure component: blank-line splitting, mixed list/paragraph blocks, a
  hyphen mid-sentence not becoming a list, `<script>` in the answer text rendering as visible
  text.

## Consequences

- The render path stays owned code with no sanitizer to keep configured, and the audit's
  no-injection-surface property is preserved by construction rather than by configuration.
- The answer prompt is unchanged, so no groundedness re-run is forced by this decision.
- Ordered lists, tables, headings and links in answer prose remain unsupported. Links stay the
  sellos' job (ADR 0004).

## What would reopen this

Tables. If the corpus work ever makes the model emit tariff tables as markdown, C's block
renderer does not stretch to that and the question is worth reopening — with the harden props
locked from the first commit.
