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

  it("warns with both hashes when Hacienda silently republishes the PDF", () => {
    const expected = "0".repeat(64);
    const notice = pdfHashNotice("tribu-cr-faq", pdf, expected);
    expect(notice.level).toBe("warn");
    expect(notice.message).toContain(`manifest ${expected}`);
    expect(notice.message).toContain(`fetched ${sha256}`);
  });

  it("rejects a malformed manifest digest", () => {
    expect(() => pdfHashNotice("tribu-cr-faq", pdf, "SHA256 TBD")).toThrow(
      /64 lowercase hex digits/,
    );
  });
});
