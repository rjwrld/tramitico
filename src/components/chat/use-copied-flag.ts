import * as React from "react";

/** How long a «copiado» confirmation stays before the label returns. */
const COPIED_DISPLAY_MS = 2000;

/**
 * A copy button's confirmation: `flash()` after the clipboard accepts, and
 * `copied` reads true for a moment, then resets on its own.
 */
export function useCopiedFlag(): [copied: boolean, flash: () => void] {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return [copied, React.useCallback(() => setCopied(true), [])];
}
