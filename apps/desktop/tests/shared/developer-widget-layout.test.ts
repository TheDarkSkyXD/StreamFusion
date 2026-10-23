import { describe, expect, it, vi } from "vitest";
import { util } from "zod/v4/core";

import {
  parseDeveloperWidgetLayout,
  shapeFromDeveloperWidgetLayout,
} from "../../src/shared/developer-widget-layout";

describe("developer widget layout boundary", () => {
  const viewport = { width: 100, height: 100 };
  const valid = { revision: 1, rectsCss: [{ x: 9.4, y: 10.2, width: 20.3, height: 30.1 }] };

  it("parses layouts when the preload cannot generate code from strings", () => {
    expect(util.allowsEval.value).toBe(true);
    vi.stubGlobal("Function", function () {
      throw new EvalError("Code generation from strings disallowed for this context");
    });

    let parsed: ReturnType<typeof parseDeveloperWidgetLayout>;
    let rejected: ReturnType<typeof parseDeveloperWidgetLayout>;
    try {
      parsed = parseDeveloperWidgetLayout(valid, viewport);
      rejected = parseDeveloperWidgetLayout({ ...valid, revision: -1 }, viewport);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(parsed).toEqual(valid);
    expect(rejected).toBeNull();
  });

  it("rounds CSS edges outward once and excludes the player", () => {
    const layout = parseDeveloperWidgetLayout(valid, viewport);
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(shapeFromDeveloperWidgetLayout(layout, viewport, 1.5)).toEqual([
      { x: 14, y: 15, width: 31, height: 46 },
    ]);
  });

  it("clips stale fullscreen rectangles after the viewport shrinks", () => {
    const resizedViewport = { width: 1400, height: 900 };
    expect(
      parseDeveloperWidgetLayout(
        {
          revision: 2,
          rectsCss: [
            { x: 0, y: 0, width: 1920, height: 500 },
            { x: 1300, y: 700, width: 500, height: 300 },
            { x: 1500, y: 200, width: 200, height: 100 },
          ],
        },
        resizedViewport
      )
    ).toEqual({
      revision: 2,
      rectsCss: [
        { x: 0, y: 0, width: 1400, height: 500 },
        { x: 1300, y: 700, width: 100, height: 200 },
      ],
    });
  });

  it("rejects invalid and excessive surfaces", () => {
    expect(parseDeveloperWidgetLayout({ ...valid, revision: -1 }, viewport)).toBeNull();
    expect(
      parseDeveloperWidgetLayout(
        { ...valid, rectsCss: Array(17).fill(valid.rectsCss[0]) },
        viewport
      )
    ).toBeNull();
    expect(
      parseDeveloperWidgetLayout(
        { ...valid, rectsCss: [{ x: 0, y: 0, width: 100, height: 100 }] },
        viewport
      )
    ).toBeNull();
    expect(
      parseDeveloperWidgetLayout(
        { ...valid, rectsCss: [{ x: 0, y: 0, width: Infinity, height: 10 }] },
        viewport
      )
    ).toBeNull();
  });
});
