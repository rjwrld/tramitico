import type { MetadataRoute } from "next";

import { PUBLIC_PATHS, siteUrl } from "@/lib/site";

/**
 * Served at `/sitemap.xml`. No `lastModified`: the pages are static and a
 * build timestamp that changes on every deploy would tell a crawler the
 * content moved when it did not.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: siteUrl(path) }));
}
