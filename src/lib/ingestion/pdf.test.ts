import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { binaryPrereqs, integrationSuite } from "../test-support/suite-gate";
import { fetchPdfSource, type FetchLike } from "./pdf";

// The zip cases shell out for real — `zip` to build the fixture, `unzip`
// inside fetchPdfSource — so they are gated like any other external
// prerequisite (#129): skipped on a machine without the tools, failed by
// name on CI, where ubuntu runners carry both.
const describeZip = integrationSuite(binaryPrereqs("zip", "unzip"));

const PDF = Buffer.from("%PDF-1.7\nfake body\n%%EOF\n");

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), "pdf-test-"));
}

function serving(body: Buffer, status = 200): FetchLike {
  return async () =>
    new Response(new Uint8Array(body), {
      status,
      headers: { "Content-Type": "application/pdf" },
    });
}

/** A real zip, so the test exercises `unzip` rather than a stubbed shape. */
function zipContaining(name: string, body: Buffer): Buffer {
  const dir = scratch();
  const staging = path.join(dir, "staging");
  mkdirSync(staging);
  writeFileSync(path.join(staging, name), body);
  execFileSync("zip", ["-q", "-j", path.join(dir, "a.zip"), name], {
    cwd: staging,
  });
  return readFileSync(path.join(dir, "a.zip"));
}

describe("fetchPdfSource", () => {
  it("returns the payload for a plain PDF url", async () => {
    const pdf = await fetchPdfSource(
      { url: "https://example.test/acta.pdf" },
      scratch(),
      serving(PDF),
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString()).toContain("fake body");
  });

  it("sends a browser User-Agent", async () => {
    let seen: HeadersInit | undefined;
    const fake: FetchLike = async (_url, init) => {
      seen = init?.headers;
      return new Response(new Uint8Array(PDF), { status: 200 });
    };

    await fetchPdfSource(
      { url: "https://example.test/a.pdf" },
      scratch(),
      fake,
    );

    expect((seen as Record<string, string>)["User-Agent"]).toMatch(/Mozilla/);
  });

  it("rejects a non-PDF payload (WAF interstitial or moved page)", async () => {
    await expect(
      fetchPdfSource(
        { url: "https://example.test/a.pdf" },
        scratch(),
        serving(Buffer.from("<html>not found</html>")),
      ),
    ).rejects.toThrow(/not a PDF/);
  });

  it("surfaces a failed request as an error, not an empty document", async () => {
    await expect(
      fetchPdfSource(
        { url: "https://example.test/a.pdf" },
        scratch(),
        serving(Buffer.from(""), 404),
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describeZip("fetchPdfSource with zip sources", () => {
  it("extracts the named member when the source is a zip", async () => {
    const zip = zipContaining("ficha tecnica.pdf", PDF);

    const pdf = await fetchPdfSource(
      { url: "https://example.test/anexos.zip", member: "ficha tecnica.pdf" },
      scratch(),
      serving(zip),
    );

    expect(pdf.toString()).toContain("fake body");
  });

  it("fails loudly when the named member is absent", async () => {
    const zip = zipContaining("otro.pdf", PDF);

    await expect(
      fetchPdfSource(
        { url: "https://example.test/anexos.zip", member: "ficha.pdf" },
        scratch(),
        serving(zip),
      ),
    ).rejects.toThrow(/ficha\.pdf/);
  });
});
