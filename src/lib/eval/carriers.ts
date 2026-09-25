/**
 * The Tier 1 carrying chunks (#287): which chunk carries each requirement
 * #412 classified as a retrieval miss, committed as `eval/tier1-carriers.json`
 * so the hit-rate lane can say where each one sat — fused pool, reranked
 * order, answer set — without an answer or a judge call.
 */
import path from "node:path";
import type { ExpectedTarget } from "./dataset";

export const CARRIERS_PATH = path.join(
  process.cwd(),
  "eval",
  "tier1-carriers.json",
);

/**
 * `docKey · articulo`, the step catalogue's `reaches` format, split on the
 * **first** separator only: a FAQ entry's articulo carries its own
 * (`Registro Único Tributario (RUT) · 1`). No separator is a whole document.
 */
export function parseChunkRef(entry: string): ExpectedTarget {
  const at = entry.indexOf(" · ");
  return at === -1
    ? { docKey: entry }
    : { docKey: entry.slice(0, at), articulo: entry.slice(at + 3) };
}

/** Case id → the chunks carrying its missing requirements. */
export function parseCarriers(text: string): Map<string, ExpectedTarget[]> {
  const raw: unknown = JSON.parse(text);
  const cases =
    typeof raw === "object" && raw !== null && "cases" in raw
      ? (raw as { cases: unknown }).cases
      : undefined;
  if (typeof cases !== "object" || cases === null || Array.isArray(cases)) {
    throw new Error("tier1-carriers.json must carry a `cases` object");
  }
  const carriers = new Map<string, ExpectedTarget[]>();
  for (const [id, refs] of Object.entries(cases)) {
    if (
      !Array.isArray(refs) ||
      refs.length === 0 ||
      !refs.every((ref) => typeof ref === "string" && ref.length > 0)
    ) {
      throw new Error(`tier1-carriers.json: ${id} needs a list of chunks`);
    }
    carriers.set(id, (refs as string[]).map(parseChunkRef));
  }
  return carriers;
}
