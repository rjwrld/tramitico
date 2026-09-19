import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-source-serif" }),
}));
vi.mock("geist/font/sans", () => ({
  GeistSans: { variable: "--font-geist-sans" },
}));
vi.mock("geist/font/mono", () => ({
  GeistMono: { variable: "--font-geist-mono" },
}));
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

import { metadata } from "./layout";

const DESCRIPTION =
  "Impuestos y trámites para quien trabaja por cuenta propia en Costa Rica. Cada respuesta, sellada a su fuente oficial.";

describe("root metadata", () => {
  it("describes the production site for Open Graph and Twitter cards", () => {
    expect(metadata.metadataBase).toEqual(new URL("https://tramitico.com"));
    expect(metadata.description).toBe(DESCRIPTION);
    expect(metadata.openGraph).toMatchObject({
      title: "Tramitico",
      description: DESCRIPTION,
      url: "https://tramitico.com",
      siteName: "Tramitico",
      locale: "es_CR",
      type: "website",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
    });
  });
});
