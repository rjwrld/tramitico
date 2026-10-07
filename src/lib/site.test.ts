import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  DEFAULT_TITLE,
  DISALLOWED_PATHS,
  OPEN_GRAPH_IMAGE,
  PUBLIC_PATHS,
  publicPageMetadata,
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
  it("allows everything but the API, and names the sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
      sitemap: "https://tramitico.com/sitemap.xml",
    });
  });

  it("leaves the noindex pages crawlable, so a crawler can read the noindex", () => {
    for (const path of ["/login", "/auth/error"]) {
      expect(DISALLOWED_PATHS.some((prefix) => path.startsWith(prefix))).toBe(
        false,
      );
    }
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

describe("publicPageMetadata", () => {
  it("gives a page its canonical and a share card of its own", () => {
    expect(publicPageMetadata("/acerca", "Acerca", "Qué es.")).toEqual({
      title: "Acerca",
      description: "Qué es.",
      alternates: { canonical: "/acerca" },
      openGraph: {
        siteName: "Tramitico",
        locale: "es_CR",
        type: "website",
        images: [OPEN_GRAPH_IMAGE],
        url: "https://tramitico.com/acerca",
        title: "Acerca — Tramitico",
        description: "Qué es.",
      },
    });
  });

  it("names the same share image the root serves, with its alt text", () => {
    const app = path.join(__dirname, "../app");
    const png = readFileSync(path.join(app, "opengraph-image.png"));
    // PNG IHDR: width and height, big-endian, at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(OPEN_GRAPH_IMAGE.width);
    expect(png.readUInt32BE(20)).toBe(OPEN_GRAPH_IMAGE.height);
    expect(
      readFileSync(path.join(app, "opengraph-image.alt.txt"), "utf8").trim(),
    ).toBe(OPEN_GRAPH_IMAGE.alt);
  });
});
