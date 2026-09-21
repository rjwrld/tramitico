# ADR 0022 — Identity linking is delegated to GoTrue and the provider

Date: 2026-09-21 · Status: accepted · Records the linking line in
[SPEC §7](../../SPEC.md#7-auth--rate-limiting) (decision 2 of
[#84](https://github.com/rjwrld/tramitico/issues/84)) · Context: issue
[#381](https://github.com/rjwrld/tramitico/issues/381), security-audit run-1 lead 3
([docs/audits/2026-09-19-security-audit.md](../audits/2026-09-19-security-audit.md))

## Context

A reader can enter Tramitico three ways: a magic link (or its six-digit code), Google, or
GitHub. Their history and their delete button hang off one `user_id`, so the same person
arriving by two of those doors must land on one account, and two different people must never
share one. SPEC §7 states the policy — same verified email resolves to one `user_id`,
unverified collisions stay separate — but the mechanism that makes it true lives entirely
outside this repository:

- **GoTrue's automatic linking** merges an incoming OAuth identity into the existing user
  with the same email, and only when both sides are verified: the existing email identity
  must be confirmed, and the provider must assert the address as verified. An unverified
  address on either side is Supabase's documented pre-account-takeover guard, and produces a
  separate account instead of a merge.
- **The provider** is what makes "verified" mean anything. Google's basic scopes return
  `email_verified`; GitHub exposes which of an account's addresses are verified and GoTrue
  reads the verified primary. With `email_optional = false` on both, GoTrue refuses an OAuth
  sign-in that carries no email at all.

The app itself does none of this. `sign-in-form.tsx` starts the flow, `/auth/callback`
exchanges the code, and every history and delete route trusts the `sub` GoTrue hands back.
Nothing in `src/` reads `email_verified`, and nothing restricts which providers may link.
`enable_manual_linking` is off, so a signed-in user cannot attach a second, differently
addressed identity either.

#84 recorded this as "accept the vendor default" and judged it not surprising enough for an
ADR. The security audit disagreed on one point: the guarantee is real, but the place it lives
is invisible from the code, and the audit's own attempt to write the test that would prove it
found there is no such test. That gap is what this record names.

## Decision

**The "both sides verified" guarantee is delegated to GoTrue and to each provider on the list
below.** The app keeps trusting the merged `sub`, keeps ignoring `email_verified`, and keeps
manual linking off. The project's side of the contract is the two preconditions the
integration test already pins: the magic-link flow leaves the address confirmed, and emails
are unique in `auth.users`.

The delegation is bounded to these providers. A provider on the form that is not in this table
is a change to the trust boundary, not a UI change, and must extend this record first.

### Trusted providers

| Provider | Email guarantee GoTrue relies on                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `google` | OpenID `email_verified` claim on the basic `openid email profile` scopes; `email_optional = false`                                          |
| `github` | GoTrue reads `/user/emails` and links only a verified address; an unverified one becomes a separate account (#84); `email_optional = false` |

The magic-link door is the project's own leg, not a delegated one: its address is verified by
the click, which the integration test proves.

### Why there is no test for the OAuth leg

The test one would want — a Google or GitHub identity with `email_verified: false` and a
matching address, asserting it does **not** merge — cannot be written against a local stack:

- GoTrue verifies real provider tokens against the provider's JWKS, so the OAuth leg cannot be
  faked from the client.
- The admin API (supabase-js 2.112's `auth.admin`) has no endpoint that creates an OAuth
  identity, so the leg cannot be fabricated from the server side either.
- Writing rows into `auth.identities` over SQL would only assert state we wrote ourselves; it
  proves nothing about the linking algorithm.

So `src/lib/identity-linking.integration.test.ts` proves the project's preconditions and stops.
The guard this record adds instead is `src/components/auth/sign-in-providers.test.ts`: a unit
test that reads the form's source and fails when it names a provider absent from the table
above, or when the local `config.toml` stops declaring the table's providers with
`email_optional = false`, or when `enable_manual_linking` turns on. It cannot see the hosted
project's dashboard; the deploy wizard and the audit's owner checks cover that side.

### What would reopen this decision

- **A provider with a looser email guarantee.** One that does not assert a verified email
  (or asserts it optionally) would let an attacker who controls only a provider account claim
  an address they do not own; automatic linking must then be reconsidered, or that provider
  kept off the form.
- **`email_optional = true`** on any listed provider, locally or on the hosted project.
- **Manual linking turned on.** It lets a signed-in user attach an identity with a different
  address, which bypasses the email match entirely.
- **A change in GoTrue's documented linking algorithm.** The decision cites the behaviour as
  documented at
  [supabase.com/docs/guides/auth/auth-identity-linking](https://supabase.com/docs/guides/auth/auth-identity-linking#automatic-linking);
  if that page stops promising the verified-only merge, the delegation no longer holds.
- **A way to exercise the OAuth leg locally** (an admin endpoint that mints an OAuth
  identity, or a GoTrue test hook). The "test that cannot be written" becomes one that can,
  and the integration test should grow it.

## Consequences

- **No behaviour change.** Sign-in, linking and the routes are as before; what changes is
  that the trust boundary is written down where the code cannot say it.
- **Adding a provider is a two-file change.** The form and this table, and the unit test
  refuses the first without the second.
- **Accepted, not compensated.** The hosted project's provider settings are dashboard state.
  Confirming `email_optional = false` on Google and GitHub there is an owner check, recorded
  as such in the audit; #358 may carry it as a row if the owner wants a review date on it.
