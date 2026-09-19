import type { MetadataRoute } from "next";

import { DISALLOWED_PATHS, siteUrl } from "@/lib/site";

/** Served at `/robots.txt` (App Router metadata file convention). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
