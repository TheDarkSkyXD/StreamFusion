import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyCompactNavigationTextMeasurement } from "@mobile/features/shell/domain/shell-layout";

const source = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);

describe("shell layout", () => {
  it("moves a measured compact row through three then two columns", () => {
    const threeColumns = applyCompactNavigationTextMeasurement("row", {
      layout: "row",
      lineCount: 2,
    });
    const twoColumns = applyCompactNavigationTextMeasurement(threeColumns, {
      layout: "grid-3",
      lineCount: 2,
    });

    expect(threeColumns).toBe("grid-3");
    expect(twoColumns).toBe("grid-2");
    expect(
      applyCompactNavigationTextMeasurement(twoColumns, {
        layout: "grid-2",
        lineCount: 2,
      }),
    ).toBe(twoColumns);
  });

  it("rejects stale text events and remounts on a viewport change", () => {
    const compact = applyCompactNavigationTextMeasurement("row", {
      layout: "row",
      lineCount: 2,
    });
    const staleRowMeasurement = applyCompactNavigationTextMeasurement(compact, {
      layout: "row",
      lineCount: 2,
    });

    expect(staleRowMeasurement).toBe(compact);
    expect(source).toContain("key={`${placement}:${width}:${fontScale}`}");
  });

  it("keeps a layout when its labels fit on one line", () => {
    expect(
      applyCompactNavigationTextMeasurement("row", {
        layout: "row",
        lineCount: 1,
      }),
    ).toBe("row");
    expect(
      applyCompactNavigationTextMeasurement("grid-3", {
        layout: "grid-3",
        lineCount: 1,
      }),
    ).toBe("grid-3");
  });

  it("keeps portrait workspace scroll bounds explicit", () => {
    expect(source).toContain("style={styles.screenScroll}");
    expect(source).toMatch(
      /screenScroll:\s*\{\s*flex:\s*1,\s*minHeight:\s*0,/u,
    );
  });
});
