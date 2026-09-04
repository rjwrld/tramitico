/** Remove corpus documents that the manifest has explicitly retired.
 *
 * `chunks.document_id` cascades on delete, so removing the document row also
 * removes every retrievable chunk left by an older ingestion (#268).
 */
export interface RetireDocumentsClient {
  from(table: "documents"): {
    delete(): {
      in(
        column: "doc_key",
        values: readonly string[],
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export async function retireDocuments(
  client: RetireDocumentsClient,
  docKeys: readonly string[],
): Promise<void> {
  if (docKeys.length === 0) return;
  const { error } = await client
    .from("documents")
    .delete()
    .in("doc_key", docKeys);
  if (error) throw new Error(`retire documents — ${error.message}`);
}
