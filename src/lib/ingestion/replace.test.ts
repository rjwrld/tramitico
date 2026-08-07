import { describe, expect, it, vi } from "vitest";
import {
  replaceDocumentChunks,
  type ReplaceChunksArgs,
  type ReplaceRpcClient,
} from "./replace";

const DOC_ID = "3f2c8a1e-0000-4000-8000-000000000059";

const chunk = (over: Partial<ReplaceChunksArgs["p_chunks"][number]> = {}) => ({
  articulo: "Artículo 1",
  path: ["Título I"],
  part: 0,
  content: "Texto del artículo.",
  ...over,
});

function fakeClient(
  result: { data: number | null; error: { message: string } | null } = {
    data: 1,
    error: null,
  },
) {
  const rpc = vi.fn<ReplaceRpcClient["rpc"]>(() => Promise.resolve(result));
  return { client: { rpc } satisfies ReplaceRpcClient, rpc };
}

describe("replaceDocumentChunks", () => {
  it("calls the RPC once with chunks paired to their embeddings", async () => {
    const { client, rpc } = fakeClient({ data: 2, error: null });
    const chunks = [
      { articulo: "Artículo 1", path: ["Título I"], part: 0, content: "Uno." },
      { articulo: null, path: [], part: 1, content: "Dos." },
    ];
    const embeddings = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];

    const inserted = await replaceDocumentChunks(
      client,
      DOC_ID,
      chunks,
      embeddings,
    );

    expect(inserted).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_chunks", {
      p_document_id: DOC_ID,
      p_chunks: [
        { ...chunks[0], embedding: [0.1, 0.2] },
        { ...chunks[1], embedding: [0.3, 0.4] },
      ],
    });
  });

  it("throws on a chunk/embedding length mismatch before any RPC call", async () => {
    const { client, rpc } = fakeClient();

    await expect(
      replaceDocumentChunks(client, DOC_ID, [chunk(), chunk()], [[0.1]]),
    ).rejects.toThrow(/2 chunks.*1 embedding/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates an RPC error with the document in the message", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "malformed vector" },
    });

    await expect(
      replaceDocumentChunks(client, DOC_ID, [chunk()], [[0.1]]),
    ).rejects.toThrow(new RegExp(`${DOC_ID}.*malformed vector`));
  });

  it("replaces with the empty set without complaint", async () => {
    const { client, rpc } = fakeClient({ data: 0, error: null });

    await expect(replaceDocumentChunks(client, DOC_ID, [], [])).resolves.toBe(
      0,
    );
    expect(rpc).toHaveBeenCalledWith("replace_chunks", {
      p_document_id: DOC_ID,
      p_chunks: [],
    });
  });
});
