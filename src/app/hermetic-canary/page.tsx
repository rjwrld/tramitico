// THROWAWAY (#88): a deliberate build-time fetch, to prove the hermetic gate
// fires. Not next/font/google on purpose — that trips src/app/fonts.test.ts,
// so `pnpm test` would fail before the build step ever ran and the gate would
// stay unverified. force-static is what makes this a *build*-time fetch: left
// dynamic, Next defers it to request time and the sandbox never sees it.
// This branch gets deleted once CI has been seen to fail.
export const dynamic = "force-static";

export default async function HermeticCanary() {
  const response = await fetch("https://example.com", { cache: "force-cache" });
  return <p>{response.status}</p>;
}
