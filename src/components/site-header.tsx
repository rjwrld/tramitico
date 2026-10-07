import Link from "next/link";

import { UserMenu } from "@/components/auth/user-menu";
import { ACERCA_LINK_LABEL, ACERCA_PATH } from "@/components/chat/privacy-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

/**
 * The home header: wordmark on the left; on the right a quiet «Acerca» text
 * link, the theme toggle and the account control. «Acerca» is chrome, not an
 * action, so it is plain muted text — no outline, no underline at rest —
 * beside the one outlined control («Iniciar sesión»).
 *
 * `px-safe` (#138): landscape on a notched phone puts the cutout beside the
 * header, so its inline padding takes whichever is larger — the design's
 * 16px or the device's inset.
 */
export function SiteHeader({
  signedIn,
  email,
}: {
  signedIn: boolean;
  email?: string;
}) {
  return (
    <header className="flex h-12 items-center justify-between border-b px-safe">
      <Link href="/" className="font-serif text-lg font-semibold">
        trami<span className="text-primary">tico</span>
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href={ACERCA_PATH}
          className="inline-flex h-8 items-center rounded-md px-2 text-sm max-[22.5rem]:hidden text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          {ACERCA_LINK_LABEL}
        </Link>
        <ThemeToggle />
        {signedIn ? (
          <UserMenu email={email ?? ""} />
        ) : (
          <Link
            href="/login"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "pointer-coarse:h-11",
            })}
          >
            Iniciar sesión
          </Link>
        )}
      </div>
    </header>
  );
}
