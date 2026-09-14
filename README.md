This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Testing

```bash
pnpm test:unit         # no database, no API keys — the required CI gate
pnpm test:integration  # needs a database: supabase start
pnpm test:eval         # needs a database, real embeddings and an Anthropic key
pnpm test              # all three, for local convenience
pnpm test:e2e          # Playwright
```

Integration and eval suites skip locally when their prerequisites are absent, and fail —
naming the missing variable — under `CI=true`, so no required check can pass while
asserting nothing.

## License

The application code in this repository is licensed under the
[Apache License 2.0](LICENSE). Copyright 2026 Ronald Josue Calderon Barrantes.

That license covers the software only. It does not cover:

- **The Tramitico name, logo and visual identity.** They are not granted for reuse by the
  software license. Forks are welcome, but not under the Tramitico name or seal.
- **Official documents and third-party content.** The Costa Rican legal texts and datasets
  the corpus is built from, and the fixtures committed under `docs/corpus-samples/` and
  `corpus/cabys-dev.json`, are public documents of their issuing institutions. Their
  sources and status are listed in
  [docs/corpus-samples/README.md](docs/corpus-samples/README.md).
- **Vendored fonts.** Source Serif 4 is under the SIL Open Font License 1.1
  (`src/app/fonts/SourceSerif4-LICENSE.txt`).

The hosted service at tramitico.com, its data and its credentials are separate from this
codebase; see [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
