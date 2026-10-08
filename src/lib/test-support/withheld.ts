/**
 * An empty `WithheldSources` for tests that hand one in by hand. It is the
 * real builder over an empty manifest, so a field added to the type arrives
 * here empty and no fixture has to learn about it (#531).
 */
import { withheldSources, type WithheldSources } from "../vigencia";

export function noneWithheld(
  overrides: Partial<WithheldSources> = {},
): WithheldSources {
  return { ...withheldSources(new Date(), { documents: [] }), ...overrides };
}
