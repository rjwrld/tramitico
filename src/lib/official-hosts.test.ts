import { describe, expect, it } from "vitest";

import manifest from "../../corpus/manifest.json";
import {
  bareHost,
  CORPUS_HOSTS,
  isOfficialEmail,
  isOfficialHost,
  OFFICIAL_HOSTS,
  officialUrl,
} from "./official-hosts";
import { ROUTING } from "./routing";

describe("official hosts", () => {
  it("lists exactly the corpus's source hosts — no more, no fewer", () => {
    const manifestHosts = (
      JSON.stringify(manifest.documents).match(/https?:\/\/[^"\s]+/g) ?? []
    ).map(bareHost);
    expect(manifestHosts.length).toBeGreaterThan(0);
    expect([...CORPUS_HOSTS].sort()).toEqual(
      [...new Set(manifestHosts)].sort(),
    );
  });

  it("covers every routed-decline front door", () => {
    expect(
      ROUTING.map((entry) => entry.url).filter(
        (url) => !isOfficialHost(new URL(url).hostname),
      ),
    ).toEqual([]);
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
