import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
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

/**
 * `viewport-fit=cover` lets the layout reach under a notch and the home
 * indicator; the surfaces that touch those edges pay their own
 * `env(safe-area-inset-*)` (issue #138). No `maximumScale`/`userScalable`:
 * pinch-zoom stays available, which is the point of the 200% reflow bar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://tramitico.com"),
  title: "Tramitico",
  description:
    "Impuestos y trámites para quien trabaja por cuenta propia en Costa Rica. Cada respuesta, sellada a su fuente oficial.",
  openGraph: {
    title: "Tramitico",
    description:
      "Impuestos y trámites para quien trabaja por cuenta propia en Costa Rica. Cada respuesta, sellada a su fuente oficial.",
    url: "https://tramitico.com",
    siteName: "Tramitico",
    locale: "es_CR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
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
          {/*
            The one toast outlet for the whole app (#139). `sonner.tsx` has
            been here since the UI kit landed and three surfaces already call
            `toast(...)` — the failed history load and the two delete paths —
            but nothing ever mounted the renderer, so every one of those was a
            no-op. Mounted inside the theme provider because the Toaster reads
            `useTheme` to pick its own palette.
          */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
