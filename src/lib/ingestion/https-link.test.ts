import { describe, expect, it } from "vitest";
import { httpsUrl } from "./https-link";

const PAGE_URL = "https://www.ccss.sa.cr/preguntas-frecuentes";

describe("httpsUrl", () => {
  it("keeps an absolute https URL", () => {
    expect(httpsUrl("https://www.ccss.sa.cr/requisitos", PAGE_URL)).toBe(
      "https://www.ccss.sa.cr/requisitos",
    );
  });

  it("resolves a relative href against the page before checking it", () => {
    expect(httpsUrl("/requisitos", PAGE_URL)).toBe(
      "https://www.ccss.sa.cr/requisitos",
    );
    expect(httpsUrl("//www.ccss.sa.cr/oficinas", PAGE_URL)).toBe(
      "https://www.ccss.sa.cr/oficinas",
    );
  });

  it("drops a relative href on a page that is not itself https", () => {
    expect(httpsUrl("/requisitos", "http://www.ccss.sa.cr/")).toBeNull();
  });

  it.each([
    "http://www.ccss.sa.cr/requisitos",
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html;base64,PGI+eDwvYj4=",
    "mailto:cobros@ccss.sa.cr",
    "tel:+50622951000",
    "https://[invalid",
  ])("drops %j", (href) => {
    expect(httpsUrl(href, PAGE_URL)).toBeNull();
  });
});
