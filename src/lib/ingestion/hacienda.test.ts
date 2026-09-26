import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pdfHashNotice } from "./hacienda";

describe("pdfHashNotice", () => {
  const pdf = Buffer.from("%PDF-1.7 audited bytes");
  const sha256 = createHash("sha256").update(pdf).digest("hex");

  it("logs a receipt when the fetched bytes match the manifest", () => {
    expect(pdfHashNotice("tribu-cr-faq", pdf, sha256)).toEqual({
      level: "info",
      message: `tribu-cr-faq: PDF SHA-256 ${sha256} matches manifest`,
    });
  });

  describe("a republished PDF", () => {
    const expected = "0".repeat(64);

    it("fails the document with both hashes and the way to accept it", () => {
      expect(() => pdfHashNotice("tribu-cr-faq", pdf, expected)).toThrow(
        new RegExp(
          `^tribu-cr-faq: PDF SHA-256 changed — manifest ${expected}, fetched ${sha256}\\..*` +
            `set source\\.sha256 to ${sha256} in corpus/manifest\\.json.*` +
            "--accept-pdf-hash tribu-cr-faq$",
        ),
      );
    });

    it("ingests with a loud warning when the run accepts that doc_key", () => {
      const notice = pdfHashNotice(
        "tribu-cr-faq",
        pdf,
        expected,
        new Set(["tribu-cr-faq"]),
      );
      expect(notice.level).toBe("warn");
      expect(notice.message).toContain(`manifest ${expected}`);
      expect(notice.message).toContain(`fetched ${sha256}`);
      expect(notice.message).toContain("ingesting anyway");
      expect(notice.message).toContain(`set source.sha256 to ${sha256}`);
    });

    it("still fails when the run accepts a different doc_key", () => {
      expect(() =>
        pdfHashNotice(
          "tribu-cr-faq",
          pdf,
          expected,
          new Set(["salario-base-2026"]),
        ),
      ).toThrow(/tribu-cr-faq: PDF SHA-256 changed/);
    });
  });

  it("does not need an acceptance for bytes that match", () => {
    expect(
      pdfHashNotice("tribu-cr-faq", pdf, sha256, new Set(["tribu-cr-faq"]))
        .level,
    ).toBe("info");
  });

  it("rejects a malformed manifest digest", () => {
    expect(() => pdfHashNotice("tribu-cr-faq", pdf, "SHA256 TBD")).toThrow(
      /64 lowercase hex digits/,
    );
  });
});
