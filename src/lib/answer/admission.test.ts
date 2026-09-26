import { describe, expect, it } from "vitest";
import { hasUnstorableText, isCrossSiteAsk } from "./admission";

function ask(headers: Record<string, string>): Request {
  return new Request("https://tramitico.com/api/ask", {
    method: "POST",
    headers,
    body: "{}",
  });
}

const JSON_TYPE = { "content-type": "application/json" };

describe("isCrossSiteAsk", () => {
  it("admits the chat client's same-origin JSON post", () => {
    expect(
      isCrossSiteAsk(
        ask({
          ...JSON_TYPE,
          "sec-fetch-site": "same-origin",
          origin: "https://tramitico.com",
          host: "tramitico.com",
        }),
      ),
    ).toBe(false);
  });

  it("admits a JSON post that carries neither browser header", () => {
    expect(isCrossSiteAsk(ask(JSON_TYPE))).toBe(false);
    expect(
      isCrossSiteAsk(
        ask({ "content-type": "application/json; charset=utf-8" }),
      ),
    ).toBe(false);
  });

  it("rejects the bodies a browser sends cross-site without a preflight", () => {
    for (const type of [
      "text/plain",
      "text/plain;charset=UTF-8",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonp",
    ]) {
      expect(isCrossSiteAsk(ask({ "content-type": type }))).toBe(true);
    }
    expect(isCrossSiteAsk(ask({}))).toBe(true);
  });

  it("rejects a JSON post the browser marks as not same-origin", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(
        isCrossSiteAsk(ask({ ...JSON_TYPE, "sec-fetch-site": site })),
      ).toBe(true);
    }
  });

  it("compares the Origin host with the forwarded host, else the host", () => {
    expect(
      isCrossSiteAsk(
        ask({
          ...JSON_TYPE,
          origin: "https://evil.example",
          host: "tramitico.com",
        }),
      ),
    ).toBe(true);
    expect(
      isCrossSiteAsk(
        ask({
          ...JSON_TYPE,
          origin: "https://preview-abc.vercel.app",
          "x-forwarded-host": "preview-abc.vercel.app",
          host: "internal.local",
        }),
      ),
    ).toBe(false);
    expect(
      isCrossSiteAsk(
        ask({ ...JSON_TYPE, origin: "null", host: "tramitico.com" }),
      ),
    ).toBe(true);
    expect(
      isCrossSiteAsk(ask({ ...JSON_TYPE, origin: "https://tramitico.com" })),
    ).toBe(true);
  });
});

describe("hasUnstorableText", () => {
  it("flags U+0000 and unpaired surrogates", () => {
    expect(hasUnstorableText("¿Cuánto es el IVA?\u0000")).toBe(true);
    expect(hasUnstorableText("IVA \ud800")).toBe(true);
    expect(hasUnstorableText("\udc00 IVA")).toBe(true);
  });

  it("passes ordinary Spanish text and paired surrogates", () => {
    expect(hasUnstorableText("¿Cuánto es el IVA? ₡ 1 000 000")).toBe(false);
    expect(hasUnstorableText("Gracias 🙏")).toBe(false);
  });
});
