import { describe, expect, it } from "vitest";

import manifest from "../../corpus/manifest.json";
import {
  isOfficialEmail,
  isOfficialHost,
  OFFICIAL_HOSTS,
  officialUrl,
} from "./official-hosts";
import { ROUTING } from "./routing";

describe("official hosts", () => {
  it("covers every host the corpus and the routed decline send people to", () => {
    const urls = [
      ...(JSON.stringify(manifest.documents).match(/https?:\/\/[^"\s]+/g) ??
        []),
      ...ROUTING.map((entry) => entry.url),
    ];
    expect(urls.length).toBeGreaterThan(0);
    const uncovered = urls
      .map((url) => new URL(url).hostname)
      .filter((host) => !isOfficialHost(host));
    expect(uncovered).toEqual([]);
  });

  it("lists bare hosts, never a www. form the subdomain rule already covers", () => {
    expect(OFFICIAL_HOSTS.filter((host) => host.startsWith("www."))).toEqual(
      [],
    );
  });

  it("matches a listed host and its subdomains, and nothing that merely ends alike", () => {
    expect(isOfficialHost("ccss.sa.cr")).toBe(true);
    expect(isOfficialHost("www.ccss.sa.cr")).toBe(true);
    expect(isOfficialHost("aissfa.ccss.sa.cr")).toBe(true);
    expect(isOfficialHost("WWW.Hacienda.go.cr")).toBe(true);
    expect(isOfficialHost("fakeccss.sa.cr")).toBe(false);
    expect(isOfficialHost("ccss.sa.cr.evil.com")).toBe(false);
    expect(isOfficialHost("sa.cr")).toBe(false);
  });

  it("links only https URLs on an official host with no credentials or port", () => {
    expect(officialUrl("https://aissfa.ccss.sa.cr/afiliacion")?.href).toBe(
      "https://aissfa.ccss.sa.cr/afiliacion",
    );
    for (const raw of [
      "http://www.ccss.sa.cr",
      "https://evil.example/ccss.sa.cr",
      "https://ccss.sa.cr@evil.example",
      "https://user:pass@www.ccss.sa.cr",
      "https://www.ccss.sa.cr:8443/",
      "javascript:alert(1)//ccss.sa.cr",
      "https://",
      "no es una url",
    ]) {
      expect(officialUrl(raw), raw).toBeNull();
    }
  });

  it("accepts an email on an official domain only", () => {
    expect(isOfficialEmail("cobros@ccss.sa.cr")).toBe(true);
    expect(isOfficialEmail("consultas@hacienda.go.cr")).toBe(true);
    expect(isOfficialEmail("alguien@gmail.com")).toBe(false);
    expect(isOfficialEmail("ccss.sa.cr")).toBe(false);
  });
});
