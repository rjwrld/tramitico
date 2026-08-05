"use client";

/**
 * Manual light/dark switch (DESIGN §1/§8). The switch arms a 150ms crossfade
 * on ground colors only — `.theme-crossfade` on <html>, consumed by
 * globals.css — and disarms it right after, so nothing else ever transitions
 * on theme change. Chrome is EN per SPEC §8.
 */
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CROSSFADE_MS = 150;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const toggle = () => {
    const root = document.documentElement;
    root.classList.add("theme-crossfade");
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
    window.setTimeout(
      () => root.classList.remove("theme-crossfade"),
      CROSSFADE_MS + 50,
    );
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggle}
    >
      {/* Icon picked by the .dark class so server and client render alike. */}
      <MoonIcon className="dark:hidden" />
      <SunIcon className="hidden dark:block" />
    </Button>
  );
}
