import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chartPath, renderChart, ROWS } from "./readme-numbers-chart";

describe("readme-numbers-chart", () => {
  it.each(["light", "dark"] as const)(
    "the committed %s SVG is what the script writes",
    (mode) => {
      expect(readFileSync(chartPath(mode), "utf8")).toBe(renderChart(mode));
    },
  );

  it("quotes the lower lane and keeps every count inside its total", () => {
    const svg = renderChart("light");
    for (const row of ROWS) {
      for (const count of row.lanes) {
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(row.of);
      }
      const low = Math.min(...row.lanes);
      const high = Math.max(...row.lanes);
      const label = low === high ? `${low}` : `${low}–${high}`;
      expect(svg).toContain(`${label} / ${row.of}`);
    }
  });
});
