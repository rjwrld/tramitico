import { describe, expect, it } from "vitest";
import { compareProbeRuns, type ProbeRead } from "./answer-set-variance";

const CONFIG = "top8/capoff/pinon";

function read(overrides: Partial<ProbeRead> & { set?: string[] }): ProbeRead {
  const { set = ["ley-iva·Artículo 5·#0", "cnpt·Artículo 78·#0"], ...rest } =
    overrides;
  return {
    id: "inscripcion-tardia-sancion",
    tier: 1,
    per: { [CONFIG]: { set } },
    ...rest,
  };
}

describe("compareProbeRuns", () => {
  it("reads a case whose two runs cut the same list as the same", () => {
    const [row] = compareProbeRuns([read({})], [read({})], CONFIG);
    expect(row).toEqual({
      id: "inscripcion-tardia-sancion",
      tier: 1,
      // A probe from before #502 recorded no variant.
      variant: null,
      sameList: true,
      sameSet: true,
      divergence: "same",
    });
  });

  it("carries the robustness block's variant through (#502)", () => {
    const [row] = compareProbeRuns(
      [read({ variant: "robustez" })],
      [read({ variant: "robustez" })],
      CONFIG,
    );
    expect(row.variant).toBe("robustez");
  });

  it("tells a reordered set from a different one", () => {
    const rows = compareProbeRuns(
      [read({ id: "a" }), read({ id: "b" })],
      [
        read({
          id: "a",
          set: ["cnpt·Artículo 78·#0", "ley-iva·Artículo 5·#0"],
        }),
        read({
          id: "b",
          set: ["ley-iva·Artículo 5·#0", "cnpt·Artículo 81·#0"],
        }),
      ],
      CONFIG,
    );
    expect(
      rows.map(({ sameList, sameSet }) => ({ sameList, sameSet })),
    ).toEqual([
      { sameList: false, sameSet: true },
      { sameList: false, sameSet: false },
    ]);
  });

  it("cannot say where runs parted that recorded only their answer sets", () => {
    // The shape every probe run before #457 wrote.
    const [row] = compareProbeRuns(
      [read({})],
      [read({ set: ["ley-iva·Artículo 5·#0"] })],
      CONFIG,
    );
    expect(row.divergence).toBe("unknown");
  });

  describe("names the first pipeline stage at which two recorded runs parted", () => {
    const pool = [
      "ley-iva·Artículo 5·#0",
      "cnpt·Artículo 78·#0",
      "cnpt·Artículo 81·#0",
    ];
    const stages = {
      query: "¿Qué pasa si me inscribí tarde en Hacienda?",
      expansion: "Sanción por omisión de la declaración de inscripción.",
      pool,
      order: pool,
    };
    const other = { set: ["ley-iva·Artículo 5·#0", "cnpt·Artículo 81·#0"] };

    it.each([
      ["query", { query: "¿Qué sanción tiene inscribirse tarde?" }],
      ["expansion", { expansion: "Inscripción tardía en el registro." }],
      ["expansion", { expansion: null }],
      ["pool", { pool: [...pool].reverse() }],
      ["rerank", { order: [...pool].reverse() }],
      ["rerank", { order: null }],
    ] as const)("%s", (stage, change) => {
      // Every later stage differs too, as it would downstream of `stage`:
      // the first difference is the one named.
      const [row] = compareProbeRuns(
        [read(stages)],
        [read({ ...stages, order: [...pool].reverse(), ...change, ...other })],
        CONFIG,
      );
      expect(row.divergence).toBe(stage);
    });

    it("cut: the same order cut to a different set", () => {
      const [row] = compareProbeRuns(
        [read(stages)],
        [read({ ...stages, ...other })],
        CONFIG,
      );
      expect(row.divergence).toBe("cut");
    });
  });

  it("leaves out a case only one run read", () => {
    const rows = compareProbeRuns(
      [read({ id: "a" }), read({ id: "b" })],
      [read({ id: "b" })],
      CONFIG,
    );
    expect(rows.map((row) => row.id)).toEqual(["b"]);
  });
});
