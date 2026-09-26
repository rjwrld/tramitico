/** What `pnpm ingest` was asked to do (scripts/ingest.ts). */
export interface IngestArgs {
  /** The doc_keys to ingest; empty means every manifest entry. */
  docKeys: string[];
  /** The doc_keys whose changed PDF this run ingests anyway. */
  acceptPdfHash: Set<string>;
}

const ACCEPT = "--accept-pdf-hash";

/**
 * Parse `pnpm ingest [doc_key…] [--accept-pdf-hash <doc_key>]…`. The flag
 * takes one doc_key and repeats, so each republished PDF is accepted by name.
 * A bare `--` is skipped: pnpm forwards it to the script verbatim.
 */
export function parseIngestArgs(argv: readonly string[]): IngestArgs {
  const docKeys: string[] = [];
  const acceptPdfHash = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === ACCEPT || arg.startsWith(`${ACCEPT}=`)) {
      const docKey = arg === ACCEPT ? argv[++i] : arg.slice(ACCEPT.length + 1);
      if (!docKey || docKey.startsWith("-")) {
        throw new Error(`${ACCEPT} needs a doc_key`);
      }
      acceptPdfHash.add(docKey);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg} (the one option is ${ACCEPT})`);
    } else {
      docKeys.push(arg);
    }
  }
  return { docKeys, acceptPdfHash };
}

/**
 * Refuse an acceptance this run has no PDF hash to spend on: a doc_key it
 * does not ingest, or one without a `source.sha256`. Left alone, a typo would
 * look like an acceptance on the command line and accept nothing.
 */
export function assertAcceptedPdfHashes(
  accepted: ReadonlySet<string>,
  docs: readonly { doc_key: string; source: { sha256?: string } }[],
): void {
  const pinned = new Set(
    docs.filter((d) => d.source.sha256).map((d) => d.doc_key),
  );
  const stray = [...accepted].filter((docKey) => !pinned.has(docKey));
  if (stray.length > 0) {
    throw new Error(
      `${ACCEPT} ${stray.join(", ")}: no PDF with a source.sha256 by that doc_key in this run`,
    );
  }
}
