# Security policy

Tramitico is a hosted service (tramitico.com) plus this open-source codebase. Security
does not depend on the source being secret: every credential lives outside the
repository, and the database is locked down at the SQL level (see
`supabase/tests/least_privilege.test.sql`).

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- Preferred: GitHub private vulnerability reporting, via the **Security → Report a
  vulnerability** button on this repository (available once the repository is public).
- Email: [privacidad@tramitico.com](mailto:privacidad@tramitico.com).

Include what you found, how to reproduce it, and what you think the impact is. Reports in
Spanish or English are both fine.

## What to expect

- An acknowledgement within 7 days.
- A fix or a mitigation plan, and a note back to you, before any public disclosure.
- Credit in the release notes if you want it.

## Scope

In scope: this repository, the hosted service at tramitico.com, and the data it stores
(see the [privacy page](https://tramitico.com/privacidad) for what that is).

Out of scope: the official sources Tramitico cites (Hacienda, CCSS, SINALEVI, BCCR) and
the third-party providers a question passes through. Report problems in those to their
owners.

## Supported versions

Only the version deployed at tramitico.com, which tracks `main`, receives fixes.
