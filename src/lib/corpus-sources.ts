/**
 * The source list `/acerca` renders (#328): every document in `public.documents`,
 * read under the service role, shaped as the `Citation` the sello already
 * knows how to print. The table is the origin on purpose — `fetched_at` is
 * the honest «consultado el», and only the ingest run stamps it. When the
 * client is not configured or the read fails, the caller gets an empty list
 * and renders its empty state; there is no manifest fallback, so the page
 * never shows a date it did not read.
 */
import type { Citation } from "./citations";
import { describeError } from "./log-redaction";
import { citationUrl, type DocumentSource } from "./retrieval";
import { tryServiceClient } from "./supabase/service";

export type CorpusSource = Citation;

export async function loadCorpusSources(): Promise<CorpusSource[]> {
  const client = tryServiceClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("documents")
      .select("doc_key, title, norma, source, effective_date, fetched_at")
      .order("title", { ascending: true });
    if (error) {
      console.error(`loadCorpusSources: ${describeError(error)}`);
      return [];
    }
    return (data ?? []).map((row) => ({
      docKey: row.doc_key,
      docTitle: row.title,
      norma: row.norma,
      articulo: null,
      url: citationUrl(row.source as DocumentSource | null),
      effectiveAt: row.effective_date,
      fetchedAt: row.fetched_at,
    }));
  } catch (error) {
    console.error(`loadCorpusSources: ${describeError(error)}`);
    return [];
  }
}
