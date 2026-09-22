/**
 * The provider-list guard from ADR 0022 (issue #381). Identity linking across
 * magic link / Google / GitHub is delegated to GoTrue and the provider's
 * verified-email guarantee, and that delegation is bounded to the providers
 * the ADR's «Trusted providers» table names. The OAuth leg itself cannot be
 * exercised locally (see the ADR), so this is the one check that CAN run with
 * nothing: it reads the sign-in form's source and fails when the form offers a
 * provider the ADR has not vetted — or when the local auth config stops
 * declaring the vetted ones the way the ADR assumes.
 *
 * Source-reading on purpose: a rendered-form test would only see the buttons,
 * and a provider added behind a flag or a second helper would slip past it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const ADR = "docs/adr/0022-identity-linking-trust-boundary.md";
const FORM = "src/components/auth/sign-in-form.tsx";
const CONFIG = "supabase/config.toml";

/** Provider ids from the ADR table: the rows whose first cell is `\`id\``. */
function adrProviders(): string[] {
  const section = read(ADR).split("### Trusted providers")[1];
  if (!section) throw new Error(`${ADR} lost its «Trusted providers» section`);
  return [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
}

/** Every provider the form can hand to signInWithOAuth — the helper's type
 *  union AND every literal call site, so neither can widen alone. */
function formProviders(): { declared: string[]; called: string[] } {
  const src = read(FORM);
  const signature = src.match(
    /function signInWithProvider\(provider: ([^)]+)\)/,
  );
  if (!signature) {
    throw new Error(`${FORM} no longer defines signInWithProvider(provider)`);
  }
  const declared = [...signature[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const called = [...src.matchAll(/signInWithProvider\("([a-z_]+)"\)/g)].map(
    (m) => m[1],
  );
  return { declared, called };
}

function sorted(xs: Iterable<string>) {
  return [...new Set(xs)].sort();
}

describe("sign-in providers stay inside ADR 0022's trust boundary", () => {
  const adr = sorted(adrProviders());

  it("the ADR table names at least one provider", () => {
    expect(adr.length).toBeGreaterThan(0);
  });

  it("the form's provider union matches the ADR table exactly", () => {
    expect(sorted(formProviders().declared)).toEqual(adr);
  });

  it("every provider button on the form is in the ADR table", () => {
    const { called } = formProviders();
    expect(called.length).toBeGreaterThan(0);
    expect(sorted(called)).toEqual(adr);
  });

  it("the form reaches signInWithOAuth only through signInWithProvider", () => {
    // A direct call would bypass the union the test above pins.
    const src = read(FORM);
    expect(src.match(/signInWithOAuth\(/g)).toHaveLength(1);
  });

  it("config.toml keeps every listed provider enabled with a required email", () => {
    const config = read(CONFIG);
    for (const provider of adr) {
      const block = config.match(
        new RegExp(
          `^\\[auth\\.external\\.${provider}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
          "m",
        ),
      );
      expect(block, `[auth.external.${provider}] missing`).not.toBeNull();
      expect(block![1]).toMatch(/^enabled = true$/m);
      expect(block![1]).toMatch(/^email_optional = false$/m);
    }
  });

  it("config.toml keeps manual linking off", () => {
    expect(read(CONFIG)).toMatch(/^enable_manual_linking = false$/m);
  });
});
