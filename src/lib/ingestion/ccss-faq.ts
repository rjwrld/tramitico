import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import type { Chunk } from "./chunker";
import { httpsUrl } from "./https-link";
import { BROWSER_UA, type FetchLike } from "./official-http";

/**
 * A human's reading of one FAQ image, recorded in the manifest (#301). Four
 * of the page's answers are pictures — the 2026 contribution-rate table and
 * the payment-date calendar by first surname letter — so their chunks used to
 * carry a heading, a source line and a link, and win top-8 slots they could
 * not use. The transcription is a claim about specific bytes: `sha256` is
 * what makes a silently republished image fail ingestion instead of carrying
 * last year's numbers forward under this year's heading.
 */
export interface FaqImageTranscription {
  /** The image URL as the page links it, resolved against the page. */
  src: string;
  /** SHA-256 of the transcribed bytes, 64 lowercase hex digits. */
  sha256: string;
  /** The image's content as text, in the source's own words. */
  text: string;
  /**
   * Where the bytes actually serve when the page's `src` is dead. The chunk
   * keeps the page's URL, because that is what the official page says; the
   * hash check goes where the bytes are. The `src` must stay dead: the day it
   * answers again, it may be serving an image nobody has read, so ingestion
   * fails until the transcription is re-read against it.
   */
  fetchFrom?: string;
}

export interface CcssFaqOptions {
  /** Relevant-question floor below which ingestion refuses to replace rows. */
  minimum?: number;
  /** Every image transcription the manifest carries for this page. */
  transcriptions?: readonly FaqImageTranscription[];
  /** Called once per chunk dropped as a body duplicate, with its survivor. */
  onDuplicate?: (dropped: Chunk, kept: Chunk) => void;
}

/**
 * The FAQ categories this corpus ingests, ranked by specificity for the
 * body-duplicate tie-break (#301). The page publishes the same answer under
 * «Seguro voluntario» and «Trabajador Independiente»; the independent-worker
 * section is the one this corpus exists for, and Cobros is the catch-all.
 * One table, so a category cannot be relevant without a rank or vice versa.
 */
const CATEGORY_RANK: Record<string, number> = {
  "Trabajador Independiente": 2,
  "Seguro voluntario": 1,
  Cobros: 0,
};
const RELEVANT_CATEGORIES = new Set(Object.keys(CATEGORY_RANK));

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

function answerOf(
  bodyHtml: string,
  pageUrl: string,
  transcriptions: ReadonlyMap<string, FaqImageTranscription>,
  seen: Set<string>,
): string {
  // An image whose src is not https still says the answer is a picture; it
  // just loses the URL, as a link loses its href below.
  const images = [...bodyHtml.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => attribute(tag, "src"))
    .filter((src): src is string => src !== null)
    .map((src) => httpsUrl(src, pageUrl));

  const withLinks = bodyHtml.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (tag, attrs: string, label: string) => {
      const href = attribute(`<a ${attrs}>`, "href");
      const url = href ? httpsUrl(href, pageUrl) : null;
      return url ? `${textOf(label)} (${url})` : textOf(tag);
    },
  );
  const text = textOf(withLinks.replace(/<img\b[^>]*>/gi, " "));
  const imageText = images.map((url) => {
    const transcription = url === null ? undefined : transcriptions.get(url);
    if (url !== null && transcription) {
      seen.add(url);
      return text.length === 0
        ? `Transcripción de la imagen que constituye la respuesta oficial (${url}): ${transcription.text}`
        : `Transcripción de la imagen incluida en la respuesta oficial (${url}): ${transcription.text}`;
    }
    const where = url === null ? "" : `: ${url}`;
    return text.length === 0
      ? `La respuesta oficial está publicada como imagen${where}.`
      : `Imagen incluida en la respuesta oficial${where}.`;
  });
  return [text, ...imageText].filter(Boolean).join(" ");
}

/** A chunk beside the answer text it was built from, before the header. */
interface ExtractedAnswer {
  chunk: Chunk;
  body: string;
}

const rank = ({ chunk }: ExtractedAnswer) =>
  CATEGORY_RANK[chunk.path[0]] * 1_000 + (chunk.articulo?.length ?? 0);

/**
 * Keep one chunk per answer body (#301). Four bodies on the live page are
 * byte-identical once the bracketed header is stripped — the same FAQ
 * published under two sections, or under two headings in one section — so
 * exact-duplicate detection never saw them and one answer took two of eight
 * retrieval slots. The survivor is the copy in the more specific section,
 * then the one with the longer heading, then the first published.
 */
function dedupeBodies(
  answers: readonly ExtractedAnswer[],
  onDuplicate?: (dropped: Chunk, kept: Chunk) => void,
): Chunk[] {
  const winners = new Map<string, ExtractedAnswer>();
  for (const answer of answers) {
    const current = winners.get(answer.body);
    if (!current || rank(answer) > rank(current))
      winners.set(answer.body, answer);
  }
  const kept = new Set(winners.values());
  for (const answer of answers) {
    if (!kept.has(answer))
      onDuplicate?.(answer.chunk, winners.get(answer.body)!.chunk);
  }
  return answers.filter((a) => kept.has(a)).map((a) => a.chunk);
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
  {
    minimum = DEFAULT_MINIMUM,
    transcriptions = [],
    onDuplicate,
  }: CcssFaqOptions = {},
): Chunk[] {
  if (!Number.isInteger(minimum) || minimum < 1) {
    throw new Error(`${docKey}: question minimum must be a positive integer`);
  }
  const transcribed = new Map(transcriptions.map((t) => [t.src, t]));
  const seenTranscriptions = new Set<string>();

  const extracted: ExtractedAnswer[] = [];
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
    const answer = answerOf(
      body.inner,
      pageUrl,
      transcribed,
      seenTranscriptions,
    );
    if (!answer)
      throw new Error(`${docKey}: empty modal answer for "${heading}"`);

    extracted.push({
      body: answer,
      chunk: {
        docKey,
        articulo: heading,
        path: [category],
        part: 0,
        content: `[${title} — ${category} — ${heading}] ${answer}`,
      },
    });
    QUESTION_BLOCK_RE.lastIndex = block.end;
  }

  // A transcription no relevant answer links any more means the image was
  // replaced (av_tv_2026.png → av_tv_2027.png): the text on file describes an
  // answer the page no longer gives, so it must be re-read, not carried over.
  const orphaned = transcriptions.filter((t) => !seenTranscriptions.has(t.src));
  if (orphaned.length > 0) {
    throw new Error(
      `${docKey}: image transcription for ${orphaned.map((t) => t.src).join(", ")} matches no image in a relevant FAQ answer — the image was replaced; re-read it and update the manifest (#301)`,
    );
  }

  const chunks = dedupeBodies(extracted, onDuplicate);
  if (chunks.length < minimum) {
    throw new Error(
      `${docKey}: found ${chunks.length} relevant FAQ questions; expected at least ${minimum}`,
    );
  }
  return chunks;
}

/**
 * Prove each transcription still describes the bytes the page serves (#301).
 * Runs before the page is extracted, so a republished image fails the run
 * rather than ingesting a transcription of something nobody has looked at.
 * Unlike a PDF `sha256`, no flag accepts a mismatch: the transcription *is*
 * the chunk's content, and there is no honest text to fall back to.
 */
export async function verifyImageTranscriptions(
  docKey: string,
  transcriptions: readonly FaqImageTranscription[],
  fetchFn: FetchLike = fetch,
): Promise<string[]> {
  for (const { src, sha256 } of transcriptions) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(
        `${docKey}: imageTranscriptions sha256 for ${src} must be 64 lowercase hex digits`,
      );
    }
  }
  const receipts: string[] = [];
  for (const { src, sha256, fetchFrom } of transcriptions) {
    if (fetchFrom !== undefined) {
      await assertSrcStillDead(docKey, src, fetchFrom, fetchFn);
    }
    const response = await fetchFn(fetchFrom ?? src, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!response.ok) {
      throw new Error(
        `${docKey}: transcribed image ${fetchFrom ?? src}: HTTP ${response.status}`,
      );
    }
    const actual = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    if (actual !== sha256) {
      throw new Error(
        `${docKey}: image ${src} changed since it was transcribed — manifest ${sha256}, fetched ${actual}; re-read it and update the manifest (#301)`,
      );
    }
    receipts.push(`${docKey}: image ${src} SHA-256 matches its transcription`);
  }
  return receipts;
}

/**
 * A `fetchFrom` hash binds the mirror's bytes, not the page's: it speaks for
 * the page's `src` only while that URL is dead. If CCSS serves `src` again —
 * with this year's calendar, say — the mirror's transcription would ride on
 * under it unread, so a live `src` fails the document. A network error counts
 * as dead, like a non-2xx: either way the page's reader gets no image.
 */
async function assertSrcStillDead(
  docKey: string,
  src: string,
  fetchFrom: string,
  fetchFn: FetchLike,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchFn(src, { headers: { "User-Agent": BROWSER_UA } });
  } catch {
    return;
  }
  if (response.ok) {
    throw new Error(
      `${docKey}: image ${src} answers again (HTTP ${response.status}), but its transcription was checked against fetchFrom ${fetchFrom} — the page may now serve a different image; re-read it, update the manifest and drop fetchFrom (#301)`,
    );
  }
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
