import { describe, expect, it } from "vitest";

import { selectStreamGridGeometry } from "@/features/multistream/components/multistream/adaptive-stream-grid";

// Guards: adaptive Multiview geometry preserves 16:9 video, maximizes visible area, and uses vertical overflow before making players unreadably short.
describe("selectStreamGridGeometry", () => {
  it("stacks two streams in a tall chat-constrained stage", () => {
    const geometry = selectStreamGridGeometry({
      width: 824,
      height: 748,
      itemCount: 2,
      gapPx: 4,
    });

    expect(geometry.columns).toBe(1);
    expect(geometry.rows).toBe(2);
    expect(geometry.overflowY).toBe(false);
    expect(geometry.slotWidthPx / geometry.slotHeightPx).toBeCloseTo(16 / 9, 2);
    expect(geometry.gridHeightPx).toBeLessThanOrEqual(748);
  });

  it("places two streams side by side in a wide stage", () => {
    const geometry = selectStreamGridGeometry({
      width: 1600,
      height: 700,
      itemCount: 2,
      gapPx: 4,
    });

    expect(geometry.columns).toBe(2);
    expect(geometry.rows).toBe(1);
    expect(geometry.overflowY).toBe(false);
  });

  it("switches to aspect-correct vertical overflow before slots become too short", () => {
    const geometry = selectStreamGridGeometry({
      width: 824,
      height: 500,
      itemCount: 8,
      gapPx: 4,
    });

    expect(geometry.columns).toBe(2);
    expect(geometry.slotHeightPx).toBeGreaterThanOrEqual(180);
    expect(geometry.overflowY).toBe(true);
    expect(geometry.gridHeightPx).toBeGreaterThan(500);
  });

  it("returns stable integer geometry for identical bounds", () => {
    const input = { width: 824, height: 748, itemCount: 5, gapPx: 4 };
    const geometry = selectStreamGridGeometry(input);

    expect(geometry).toEqual(selectStreamGridGeometry(input));
    expect(
      [
        geometry.columns,
        geometry.rows,
        geometry.slotWidthPx,
        geometry.slotHeightPx,
        geometry.gridWidthPx,
        geometry.gridHeightPx,
      ].every(Number.isInteger)
    ).toBe(true);
  });
});
