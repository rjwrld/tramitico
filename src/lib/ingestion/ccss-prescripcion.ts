import { decodeHTML } from "entities";
import type { Chunk } from "./chunker";
import { BROWSER_UA, type FetchLike } from "./official-http";

const DEFAULT_MINIMUM = 20;
const H3_RE = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;

interface ElementSlice {
  inner: string;
  end: number;
}

/** Return the contents of an element whose body may contain the same tag. */
function balancedElement(
  html: string,
  tagName: string,
  openStart: number,
  openEnd: number,
): ElementSlice {
  const tags = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += new RegExp(`^<\\/${tagName}`, "i").test(tag[0]) ? -1 : 1;
    if (depth === 0) {
      return { inner: html.slice(openEnd, tag.index), end: tags.lastIndex };
    }
  }
  throw new Error(
    `CCSS prescripción: unclosed <${tagName}> starting at byte ${openStart}`,
  );
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
    throw new Error(`CCSS prescripción: invalid linked URL "${value}"`);
  }
}

function textOf(html: string, pageUrl: string): string {
  const withLinks = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (tag, attrs: string, label: string) => {
      const href = attribute(`<a ${attrs}>`, "href");
      const text = plainText(label);
      return href ? `${text} (${absoluteUrl(href, pageUrl)})` : plainText(tag);
    },
  );
  return plainText(withLinks);
}

function plainText(html: string): string {
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

function chunk(
  docKey: string,
  title: string,
  heading: string,
  path: string,
  body: string,
): Chunk {
  return {
    docKey,
    articulo: heading,
    path: [path],
    part: 0,
    content: `[${title} — ${path} — ${heading}] ${body}`,
  };
}

/**
 * Extract the CCSS prescripción microsite by the headings a reader sees.
 *
 * The page has two useful shapes: explanatory sections headed with `<h3>`,
 * and a FAQ whose questions are accordion links. Both become one citation
 * boundary per heading. Repeated explanatory headings are merged so two DOM
 * presentations of “¿Cómo se solicita…?” cannot create duplicate citation
 * keys in the corpus.
 */
export function extractCcssPrescripcionChunks(
  docKey: string,
  title: string,
  html: string,
  pageUrl: string,
  minimum = DEFAULT_MINIMUM,
): Chunk[] {
  if (!Number.isInteger(minimum) || minimum < 1) {
    throw new Error(`${docKey}: heading minimum must be a positive integer`);
  }

  const faqStart = html.search(
    /<section\b[^>]*\bid=(?:"why-us"|'why-us')[^>]*>/i,
  );
  if (faqStart < 0) {
    throw new Error(`${docKey}: FAQ section #why-us not found`);
  }

  // The page appends old campaign-video transcripts after the live guide.
  // They retain launch-era wording such as “los próximos 24 meses”; stop at
  // the explicit boundary so that stale narration cannot compete with the
  // current plazo section and its dates.
  const videosStart = html.search(/<!--\s*Videos\s*-->/i);
  const guideEnd =
    videosStart >= 0 && videosStart < faqStart ? videosStart : faqStart;
  const guide = html.slice(0, guideEnd);
  const headings = [...guide.matchAll(H3_RE)];
  const guideBodies = new Map<string, string[]>();
  for (let index = 0; index < headings.length; index++) {
    const match = headings[index];
    const heading = plainText(match[1]);
    if (!heading) continue;
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = headings[index + 1]?.index ?? guide.length;
    const body = textOf(guide.slice(bodyStart, bodyEnd), pageUrl);
    if (!body) continue;
    const bodies = guideBodies.get(heading) ?? [];
    if (!bodies.includes(body)) bodies.push(body);
    guideBodies.set(heading, bodies);
  }

  const chunks = [...guideBodies].map(([heading, bodies]) =>
    chunk(docKey, title, heading, "Guía", bodies.join(" ")),
  );

  const faq = html.slice(faqStart);
  const liOpen = /<li\b[^>]*>/gi;
  for (let match = liOpen.exec(faq); match; match = liOpen.exec(faq)) {
    const item = balancedElement(faq, "li", match.index, liOpen.lastIndex);
    const anchor = item.inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) {
      liOpen.lastIndex = item.end;
      continue;
    }
    const heading = plainText(anchor[1]).replace(/^\d+\s*/, "");
    const body = textOf(item.inner.replace(anchor[0], " "), pageUrl);
    if (heading && body) {
      chunks.push(chunk(docKey, title, heading, "Preguntas frecuentes", body));
    }
    liOpen.lastIndex = item.end;
  }

  if (chunks.length < minimum) {
    throw new Error(
      `${docKey}: found ${chunks.length} heading chunks; expected at least ${minimum}`,
    );
  }
  return chunks;
}

export async function fetchCcssPrescripcion(
  url: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!response.ok) {
    const detail =
      response.status === 403 ? " (browser User-Agent rejected)" : "";
    throw new Error(
      `CCSS prescripción fetch failed: HTTP ${response.status}${detail}`,
    );
  }
  return response.text();
}

export function headingCountMessage(
  current: number,
  previous?: number,
): string {
  if (previous === undefined)
    return `${current} heading chunks (no cached baseline)`;
  const delta = current - previous;
  return `${current} heading chunks (change from cached crawl: ${delta >= 0 ? "+" : ""}${delta})`;
}
