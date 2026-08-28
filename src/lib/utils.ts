import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Open-redirect guard for auth ?next= params: same-origin relative paths only.
// Backslashes are rejected outright, not just at the second position: WHATWG
// URL parsing treats `\` as `/` for http(s), so `Location: /\evil.com` is
// protocol-relative — and no legitimate app path contains one (#210).
export function safeNextPath(next: string | null): string {
  if (next && /^\/(?![/\\])/.test(next) && !next.includes("\\")) return next;
  return "/";
}

/**
 * Whether the viewer asked for reduced motion (#219). Guarded for SSR and for
 * jsdom, where `matchMedia` does not exist — both read as "no preference".
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
