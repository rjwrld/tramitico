import { describe, expect, it } from "vitest";
import { assertAcceptedPdfHashes, parseIngestArgs } from "./ingest-args";

describe("parseIngestArgs", () => {
  it("reads bare arguments as doc_keys, and none as the whole manifest", () => {
    expect(parseIngestArgs([])).toEqual({
      docKeys: [],
      acceptPdfHash: new Set(),
    });
    expect(parseIngestArgs(["ley-10363", "cnpt"]).docKeys).toEqual([
      "ley-10363",
      "cnpt",
    ]);
  });

  it("collects each --accept-pdf-hash by name, in both spellings", () => {
    const args = parseIngestArgs([
      "tribu-cr-faq",
      "--accept-pdf-hash",
      "tribu-cr-faq",
      "--accept-pdf-hash=salario-base-2026",
    ]);
    expect(args.docKeys).toEqual(["tribu-cr-faq"]);
    expect([...args.acceptPdfHash]).toEqual([
      "tribu-cr-faq",
      "salario-base-2026",
    ]);
  });

  it("skips the -- that pnpm forwards to the script", () => {
    expect(
      parseIngestArgs(["--", "cnpt", "--accept-pdf-hash", "cnpt"]),
    ).toEqual({ docKeys: ["cnpt"], acceptPdfHash: new Set(["cnpt"]) });
  });

  it.each([
    [["--accept-pdf-hash"]],
    [["--accept-pdf-hash="]],
    [["--accept-pdf-hash", "--accept-pdf-hash", "cnpt"]],
  ])("refuses an --accept-pdf-hash without a doc_key: %j", (argv) => {
    expect(() => parseIngestArgs(argv)).toThrow(
      /--accept-pdf-hash needs a doc_key/,
    );
  });

  it("refuses an option it does not know rather than read it as a doc_key", () => {
    expect(() => parseIngestArgs(["--accept-pdf", "cnpt"])).toThrow(
      /Unknown option --accept-pdf/,
    );
  });
});

describe("assertAcceptedPdfHashes", () => {
  const docs = [
    { doc_key: "tribu-cr-faq", source: { sha256: "a".repeat(64) } },
    { doc_key: "cnpt", source: {} },
  ];

  it("allows an acceptance for a pinned PDF in this run", () => {
    expect(() =>
      assertAcceptedPdfHashes(new Set(["tribu-cr-faq"]), docs),
    ).not.toThrow();
  });

  it("refuses an acceptance with no pinned PDF in this run to spend it on", () => {
    expect(() =>
      assertAcceptedPdfHashes(
        new Set(["tribu-cr-faq", "cnpt", "tribu-cr-faqq"]),
        docs,
      ),
    ).toThrow(
      /--accept-pdf-hash cnpt, tribu-cr-faqq: no PDF with a source\.sha256/,
    );
  });
});
