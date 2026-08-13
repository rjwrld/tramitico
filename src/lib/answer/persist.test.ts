import { describe, expect, it, vi } from "vitest";
import { saveQuestion, type QuestionsClient } from "./persist";

function client(error: { message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as QuestionsClient, from, insert };
}

const INPUT = {
  userId: "user-1",
  question: "¿Cuánto es el IVA?",
  answer: "13% [1].",
  citations: [
    {
      docKey: "ley-9635",
      docTitle: "Ley 9635",
      norma: null,
      articulo: "Artículo 4",
      url: null,
    },
  ],
};

describe("saveQuestion", () => {
  it("inserts the exchange stamped with the user id", async () => {
    const { client: fake, from, insert } = client();
    await saveQuestion(INPUT, fake);
    expect(from).toHaveBeenCalledWith("questions");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      question: "¿Cuánto es el IVA?",
      // The seal numbering the reader saw, kept so history can render the
      // same superscripts (#133).
      answer: "13%[1].",
      citations: INPUT.citations,
    });
  });

  it("drops a marker with no seal behind it", async () => {
    const { client: fake, insert } = client();
    await saveQuestion({ ...INPUT, answer: "13% [1] y algo más [4]." }, fake);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "13%[1] y algo más." }),
    );
  });

  it("logs and swallows insert failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client: fake } = client({ message: "boom" });
    await expect(saveQuestion(INPUT, fake)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("insert failed: boom"),
    );
    spy.mockRestore();
  });
});
