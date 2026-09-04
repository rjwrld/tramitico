import { decodeHTML } from "entities";
import type { Chunk } from "./chunker";
import { BROWSER_UA, type FetchLike } from "./official-http";

const RELEVANT_CATEGORIES = new Set([
  "Cobros",
  "Seguro voluntario",
  "Trabajador Independiente",
]);

const DEFAULT_MINIMUM = 25;
const QUESTION_BLOCK_RE =
  /<div\b[^>]*class=(?:"[^"]*\bfaq-question-text\b[^"]*"|'[^']*\bfaq-question-text\b[^']*')[^>]*>/gi;
const MODAL_BODY_RE =
  /<div\b[^>]*class=(?:"[^"]*\bmodal-body\b[^"]*"|'[^']*\bmodal-body\b[^']*')[^>]*>/gi;

interface DivElement {
  inner: string;
  end: number;
}

/** Find the matching close tag for a div, including bodies with nested divs. */
function balancedDiv(
  html: string,
  openStart: number,
  openEnd: number,
): DivElement {
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += /^<\/div/i.test(tag[0]) ? -1 : 1;
    if (depth === 0) {
      return { inner: html.slice(openEnd, tag.index), end: tags.lastIndex };
    }
  }
  throw new Error(`CCSS FAQ: unclosed div starting at byte ${openStart}`);
}

function textOf(html: string): string {
  return decodeHTML(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match ? decodeHTML(match[1] ?? match[2] ?? match[3]) : null;
}

function absoluteUrl(value: string, pageUrl: string): string {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    throw new Error(`CCSS FAQ: invalid linked URL "${value}"`);
  }
}

function answerOf(bodyHtml: string, pageUrl: string): string {
  const images = [...bodyHtml.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => attribute(tag, "src"))
    .filter((src): src is string => src !== null)
    .map((src) => absoluteUrl(src, pageUrl));

  const withLinks = bodyHtml.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (tag, attrs: string, label: string) => {
      const href = attribute(`<a ${attrs}>`, "href");
      return href
        ? `${textOf(label)} (${absoluteUrl(href, pageUrl)})`
        : textOf(tag);
    },
  );
  const text = textOf(withLinks.replace(/<img\b[^>]*>/gi, " "));
  const imageNotice = images.map((url) =>
    text.length === 0
      ? `La respuesta oficial está publicada como imagen: ${url}.`
      : `Imagen incluida en la respuesta oficial: ${url}.`,
  );
  return [text, ...imageNotice].filter(Boolean).join(" ");
}

function idPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<div\\b[^>]*\\bid=(?:"${escaped}"|'${escaped}')[^>]*>`,
    "i",
  );
}

/**
 * Extract the CCSS table/modal page as one citable chunk per question.
 * The visible `<strong>` is the citation label, its category is the path,
 * and only the matching modal body contributes answer text.
 */
export function extractCcssFaqChunks(
  docKey: string,
  title: string,
  html: string,
  pageUrl: string,
  minimum = DEFAULT_MINIMUM,
): Chunk[] {
  if (!Number.isInteger(minimum) || minimum < 1) {
    throw new Error(`${docKey}: question minimum must be a positive integer`);
  }

  const chunks: Chunk[] = [];
  QUESTION_BLOCK_RE.lastIndex = 0;
  for (
    let match = QUESTION_BLOCK_RE.exec(html);
    match;
    match = QUESTION_BLOCK_RE.exec(html)
  ) {
    const block = balancedDiv(html, match.index, QUESTION_BLOCK_RE.lastIndex);
    const heading = textOf(
      block.inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? "",
    );
    const category = textOf(
      block.inner.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? "",
    );
    if (!RELEVANT_CATEGORIES.has(category)) continue;
    if (!heading)
      throw new Error(`${docKey}: relevant FAQ row has no <strong> heading`);

    const nextQuestion = html
      .slice(block.end)
      .search(
        /<div\b[^>]*class=(?:"[^"]*\bfaq-question-text\b[^"]*"|'[^']*\bfaq-question-text\b[^']*')[^>]*>/i,
      );
    const searchEnd = nextQuestion < 0 ? html.length : block.end + nextQuestion;
    const between = html.slice(block.end, searchEnd);
    const target = between.match(
      /\bdata-bs-target\s*=\s*["']#([^"']+)["']/i,
    )?.[1];
    if (!target) throw new Error(`${docKey}: no modal target for "${heading}"`);

    const modalMatch = html
      .slice(block.end, searchEnd)
      .match(idPattern(target));
    if (modalMatch?.index === undefined) {
      throw new Error(`${docKey}: modal #${target} not found for "${heading}"`);
    }
    const modalStart = block.end + modalMatch.index + modalMatch[0].length;
    MODAL_BODY_RE.lastIndex = modalStart;
    const bodyOpen = MODAL_BODY_RE.exec(html);
    if (!bodyOpen || bodyOpen.index >= searchEnd) {
      throw new Error(`${docKey}: modal body not found for "${heading}"`);
    }
    const body = balancedDiv(html, bodyOpen.index, MODAL_BODY_RE.lastIndex);
    const answer = answerOf(body.inner, pageUrl);
    if (!answer)
      throw new Error(`${docKey}: empty modal answer for "${heading}"`);

    chunks.push({
      docKey,
      articulo: heading,
      path: [category],
      part: 0,
      content: `[${title} — ${category} — ${heading}] ${answer}`,
    });
    QUESTION_BLOCK_RE.lastIndex = block.end;
  }

  if (chunks.length < minimum) {
    throw new Error(
      `${docKey}: found ${chunks.length} relevant FAQ questions; expected at least ${minimum}`,
    );
  }
  return chunks;
}

export async function fetchCcssFaq(
  url: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!response.ok) {
    const detail =
      response.status === 403 ? " (browser User-Agent rejected)" : "";
    throw new Error(`CCSS FAQ fetch failed: HTTP ${response.status}${detail}`);
  }
  return response.text();
}

export function faqCountMessage(current: number, previous?: number): string {
  if (previous === undefined)
    return `${current} relevant questions (no cached baseline)`;
  const delta = current - previous;
  return `${current} relevant questions (change from cached crawl: ${delta >= 0 ? "+" : ""}${delta})`;
}
