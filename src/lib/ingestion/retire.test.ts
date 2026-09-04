import { describe, expect, it, vi } from "vitest";
import { retireDocuments, type RetireDocumentsClient } from "./retire";

describe("retireDocuments", () => {
  it("deletes manifest-retired documents by doc_key", async () => {
    const inFilter = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn(() => ({ in: inFilter }));
    const from = vi.fn(() => ({ delete: remove }));

    await retireDocuments({ from } as RetireDocumentsClient, ["ley-9635"]);

    expect(from).toHaveBeenCalledWith("documents");
    expect(remove).toHaveBeenCalledOnce();
    expect(inFilter).toHaveBeenCalledWith("doc_key", ["ley-9635"]);
  });

  it("does not issue a broad delete when the retirement list is empty", async () => {
    const from = vi.fn();
    await retireDocuments({ from } as unknown as RetireDocumentsClient, []);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces a failed retirement before the corpus index is dumped", async () => {
    const client = {
      from: () => ({
        delete: () => ({
          in: () => Promise.resolve({ error: { message: "database offline" } }),
        }),
      }),
    } as RetireDocumentsClient;

    await expect(retireDocuments(client, ["ley-9635"])).rejects.toThrow(
      "retire documents — database offline",
    );
  });
});
