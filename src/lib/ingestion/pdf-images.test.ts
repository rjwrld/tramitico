import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pdfImageNotice } from "./pdf-images";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

describe("pdfImageNotice", () => {
  it("says nothing when pdfimages finds no images", () => {
    expect(
      pdfImageNotice("tramos-renta-2026", fixture("pdfimages-no-images.txt")),
    ).toBeNull();
  });

  it("says nothing for seal-sized images below the corpus-derived floor", () => {
    expect(
      pdfImageNotice("ccss-escala-ivm", fixture("pdfimages-seal-only.txt")),
    ).toBeNull();
  });

  it("warns about a table-sized image without treating its soft mask as another image", () => {
    const notice = pdfImageNotice(
      "ccss-escala-ivm",
      fixture("pdfimages-table-image.txt"),
    );

    expect(notice?.level).toBe("warn");
    expect(notice?.message).toContain("ccss-escala-ivm");
    expect(notice?.message).toContain("1 substantial-size PDF image");
    expect(notice?.message).toContain("p1-obj33-0 (765×614)");
    expect(notice?.message).toContain("check");
    expect(notice?.message).not.toContain("2 substantial-size PDF images");
  });

  it("ignores a table-sized image outside the ingested page range", () => {
    expect(
      pdfImageNotice(
        "page-ranged-acta",
        fixture("pdfimages-image-outside-range.txt"),
        { pages: "1-3" },
      ),
    ).toBeNull();
  });

  describe("imagesAudited (#177)", () => {
    it("quiets the notice when every substantial image was audited", () => {
      expect(
        pdfImageNotice(
          "ccss-escala-ivm",
          fixture("pdfimages-table-image.txt"),
          { imagesAudited: ["p1-obj27-0", "p1-obj33-0"] },
        ),
      ).toEqual({
        level: "info",
        message:
          "ccss-escala-ivm: 1 substantial-size PDF image, audited (#196)",
      });
    });

    it("restores the warning and names a substantial image outside the audit", () => {
      const notice = pdfImageNotice(
        "ccss-escala-ivm",
        fixture("pdfimages-table-image.txt"),
        { imagesAudited: ["p2-obj99-0"] },
      );

      expect(notice?.level).toBe("warn");
      expect(notice?.message).toContain("not in the audited set");
      expect(notice?.message).toContain("p1-obj33-0");
      expect(notice?.message).not.toContain("p2-obj99-0");
    });
  });
});
