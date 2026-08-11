import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * The three DESIGN §3 voices, loaded hermetically (issue #83).
 *
 * `next/font/google` downloads the files at build time, so every `pnpm build`
 * dialed Google's font hosts and a blip there failed CI. `geist` ships the
 * sans/mono binaries in the package (same OFL faces, same `--font-geist-*`
 * variable names), and Source Serif 4 is vendored under ./fonts — no network
 * in the build, same self-hosted serving as before.
 */
const sourceSerif = localFont({
  src: "./fonts/SourceSerif4-Variable-latin.woff2",
  variable: "--font-source-serif",
  // The file carries the full wght axis; the declaration pins DESIGN §3's
  // 500–600. The Google config served those two instances and nothing else, so
  // pinning keeps a stray `font-bold` clamping to 600 exactly as it did before
  // — this is a build fix, not a rendering change.
  weight: "500 600",
  // Default fallback metrics are Arial's — wrong shape for a serif face.
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "Tramitico",
  description:
    "Respuestas sobre impuestos y trámites para desarrolladores independientes en Costa Rica — con cita al artículo oficial.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
