// Free: per arm, whether the step catalogue's reached chunks sit in the answer set
// identically on all five draws, against the R2 step-pinned subset. Approximate:
// a family's `reaches` stand in for its picks, which the probe does not record.
//
//   node eval/runs/2026-10-12-611/reach-stability.mjs control pins3 pins5
import { readFileSync } from "node:fs";
const cat = JSON.parse(
  readFileSync("eval/step-catalogue.json", "utf8"),
).families;
const C = "top8/capoff/pinon";
for (const arm of process.argv.slice(2)) {
  const draws = [1, 2, 3, 4, 5].map(
    (i) =>
      new Map(
        JSON.parse(
          readFileSync(
            `eval/runs/2026-10-12-611/${arm}/probe-${i}.json`,
            "utf8",
          ),
        ).reads.map((r) => [r.id, r]),
      ),
  );
  let same = 0,
    sameStep = 0,
    n = 0;
  for (const [id, r0] of draws[0]) {
    if (r0.tier !== 1 || r0.variant === "robustez" || !r0.steps) continue;
    const reaches = cat[r0.steps]?.reaches ?? [];
    const key = (r) => {
      if (!r) return null;
      const e = r.per[C];
      return e.set
        .filter((l) =>
          reaches.some((x) => {
            const [d, a] = [
              x.split(" · ")[0],
              x.split(" · ").slice(1).join(" · "),
            ];
            const ld = l.split("·")[0];
            const la = l.slice(ld.length + 1, l.lastIndexOf("·#"));
            return d === ld && (!a || a === la);
          }),
        )
        .sort()
        .join("|");
    };
    const stepKey = (r) =>
      r
        ? Object.entries(r.per[C].pins ?? {})
            .filter(([, p]) => p === "step")
            .map(([l]) => l)
            .sort()
            .join("|")
        : null;
    const ks = draws.map((d) => key(d.get(id))).filter((k) => k !== null);
    const ss = draws.map((d) => stepKey(d.get(id))).filter((k) => k !== null);
    n++;
    if (new Set(ks).size === 1) same++;
    if (new Set(ss).size === 1) sameStep++;
  }
  console.log(
    `${arm}: catalogue-reached chunks in the set identical ${same}/${n}; step-pinned subset identical ${sameStep}/${n}`,
  );
}
