/**
 * The crawl surface: what the site is called, where it lives, and which
 * routes a search engine may index. `robots.ts`, `sitemap.ts`, the root
 * layout's `metadataBase` and the per-page canonicals all read from here so
 * the four cannot disagree about the origin or the public page list.
 */

export const SITE_NAME = "Tramitico";

/** The production origin. No trailing slash; `siteUrl` joins paths. */
export const SITE_ORIGIN = "https://tramitico.com";

export const REPOSITORY_URL = "https://github.com/rjwrld/tramitico";

/**
 * The `<title>` of `/`. The wordmark first, then the two institutions and
 * the audience in the vocabulary the demand research recorded (#264): people
 * search «trabajador independiente», not «desarrollador».
 */
export const DEFAULT_TITLE =
  "Tramitico — Hacienda y CCSS para trabajadores independientes";

/** Every child page's `<title>` ends in the wordmark. */
export const TITLE_TEMPLATE = `%s — ${SITE_NAME}`;

/**
 * The indexable routes, in the order the sitemap lists them. A new public
 * page joins here and gets an `alternates.canonical` in its own metadata.
 */
export const PUBLIC_PATHS = [
  "/",
  "/acerca",
  "/privacidad",
  "/terminos",
] as const;

/**
 * Routes a crawler has no business in: the sign-in form (its page also
 * carries `noindex`) and the API. `/api/` is a prefix, so the trailing slash
 * matters.
 */
export const DISALLOWED_PATHS = ["/login", "/api/"] as const;

/**
 * `/` maps to the bare origin, no trailing slash: that is the form Next.js
 * emits for the root canonical, and the sitemap must list the same string.
 */
export function siteUrl(path: string): string {
  if (path === "/") return SITE_ORIGIN;
  return new URL(path, SITE_ORIGIN).toString();
}

/**
 * The JSON-LD the root layout serves on every page: the site and the
 * organisation behind it. No `FAQPage` — the seed prompts are questions
 * without static answers, and Google restricted that rich result to
 * government and health sites in 2023.
 */
export function structuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: SITE_ORIGIN,
        name: SITE_NAME,
        inLanguage: "es-CR",
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: SITE_NAME,
        url: SITE_ORIGIN,
        logo: siteUrl("/icon.svg"),
        sameAs: [REPOSITORY_URL],
      },
    ],
  };
}

/**
 * Serialised for an inline `<script type="application/ld+json">`. The `<`
 * escape is the one the Next.js JSON-LD guide prescribes: a `</script>` in
 * any string value would otherwise close the tag.
 */
export function structuredDataJson(): string {
  return JSON.stringify(structuredData()).replace(/</g, "\\u003c");
}
