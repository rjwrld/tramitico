/**
 * The URL an extractor may write into a chunk beside a link's text, or null.
 *
 * The CCSS extractors inline each upstream href as «text (url)», and from the
 * chunk it reaches the prompt and the chat. Nothing renders it as a link
 * today, but the corpus should not carry a `javascript:`, `data:`, `mailto:`
 * or plain `http:` URL for a later renderer to trust: only an absolute https
 * URL survives, a relative href resolved against the page first. The caller
 * keeps the link text either way.
 */
export function httpsUrl(href: string, pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }
  return url.protocol === "https:" ? url.toString() : null;
}
