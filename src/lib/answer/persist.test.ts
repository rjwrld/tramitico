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
    await expect(saveQuestion(INPUT, fake)).resolves.toBe(true);
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

  it("logs an insert failure and reports it as unsaved (#139)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client: fake } = client({ message: "boom" });
    // Still swallowed — it never throws at the caller — but the false is what
    // the route turns into the `data-unsaved` part behind the toast.
    await expect(saveQuestion(INPUT, fake)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("insert failed:"));
    // #136: the row Postgres refused is the user's question, so the driver's
    // message never reaches the log — only what the error *is*.
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("boom"));
    spy.mockRestore();
  });
});
