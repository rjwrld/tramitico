import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  DEFAULT_TITLE,
  DISALLOWED_PATHS,
  PUBLIC_PATHS,
  SITE_ORIGIN,
  siteUrl,
  structuredData,
  structuredDataJson,
} from "./site";

describe("siteUrl", () => {
  it("joins a path onto the production origin", () => {
    expect(siteUrl("/")).toBe("https://tramitico.com");
    expect(siteUrl("/acerca")).toBe("https://tramitico.com/acerca");
    expect(siteUrl("/sitemap.xml")).toBe("https://tramitico.com/sitemap.xml");
  });
});

describe("robots.txt", () => {
  it("allows everything but the sign-in form and the API, and names the sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/login", "/api/"] },
      sitemap: "https://tramitico.com/sitemap.xml",
    });
  });

  it("disallows only routes the sitemap does not list", () => {
    for (const path of DISALLOWED_PATHS) {
      expect(PUBLIC_PATHS).not.toContain(path);
    }
  });
});

describe("sitemap.xml", () => {
  it("lists every public page as an absolute URL, in order", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://tramitico.com",
      "https://tramitico.com/acerca",
      "https://tramitico.com/privacidad",
      "https://tramitico.com/terminos",
    ]);
  });

  it("carries no lastModified — the pages are static", () => {
    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeUndefined();
    }
  });
});

describe("structured data", () => {
  it("describes the site and the organisation behind it", () => {
    const graph = structuredData()["@graph"] as Array<Record<string, unknown>>;
    expect(graph.map((node) => node["@type"])).toEqual([
      "WebSite",
      "Organization",
    ]);
    const [website, organization] = graph;
    expect(website).toMatchObject({
      url: SITE_ORIGIN,
      name: "Tramitico",
      inLanguage: "es-CR",
      publisher: { "@id": organization["@id"] },
    });
    expect(organization).toMatchObject({
      name: "Tramitico",
      logo: "https://tramitico.com/icon.svg",
      sameAs: ["https://github.com/rjwrld/tramitico"],
    });
  });

  it("serialises without a raw < that could close the script tag", () => {
    const json = structuredDataJson();
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(structuredData());
  });
});

describe("default title", () => {
  it("stays inside the ~60 characters a result page shows", () => {
    expect(DEFAULT_TITLE.length).toBeLessThanOrEqual(60);
    expect(DEFAULT_TITLE.startsWith("Tramitico")).toBe(true);
  });
});
