/**
 * The official sites an answer may link to from its prose.
 *
 * ADR 0008 kept every URL the model writes as inert text: nothing the model
 * echoes reached an attribute. Its amendment narrows that to one gate — a
 * URL becomes a link only when it parses as `https`, carries no credentials
 * or port, and its host is one of these or a subdomain of one. Everything
 * else stays text, so a hallucinated or hostile host can never be clicked.
 *
 * Hosts, not suffixes: anyone can register a `.sa.cr` or `.com`, so a TLD
 * proves nothing. The list is exactly the hosts the product already sends
 * people to — the corpus's sources (`corpus/manifest.json`) and the routed
 * decline's front doors (`ROUTING` in `routing.ts`). `official-hosts.test.ts`
 * fails if either gains a host this list does not cover.
 */
export const OFFICIAL_HOSTS: readonly string[] = [
  // Corpus sources.
  "bccr.fi.cr",
  "ccss.sa.cr",
  "hacienda.go.cr",
  "imprentanacional.go.cr",
  "poder-judicial.go.cr",
  "sinalevi.go.cr",
  // Routed-decline front doors.
  "ccpa.or.cr",
  "cpic.or.cr",
  "csv.go.cr",
  "grupoins.com",
  "ifam.go.cr",
  "meic.go.cr",
  "migracion.go.cr",
  "mtss.go.cr",
  "rnpdigital.com",
  "sugef.fi.cr",
];

/** `aissfa.ccss.sa.cr` → true; `ccss.sa.cr.evil.com` → false. */
export function isOfficialHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return OFFICIAL_HOSTS.some(
    (official) => host === official || host.endsWith(`.${official}`),
  );
}

/** The URL to link to, or null when `raw` must stay text. */
export function officialUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  return isOfficialHost(url.hostname) ? url : null;
}

/** `cobros@ccss.sa.cr` → true. The address itself is matched by the caller. */
export function isOfficialEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  return at > 0 && isOfficialHost(address.slice(at + 1));
}
