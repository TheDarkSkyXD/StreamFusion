import { describe, expect, it } from "vitest";

import {
  beginMiniPlayerGesture,
  clampMiniPlayerFrame,
  initialMiniPlayerFrame,
  moveMiniPlayerGesture,
} from "../domain/mini-player-geometry";

const bounds = { left: 0, top: 0, right: 400, bottom: 800 };

describe("mini-player geometry", () => {
  it("starts at the lower right and fits in narrow or short workspaces", () => {
    expect(initialMiniPlayerFrame(bounds)).toEqual({
      x: 152,
      y: 657,
      width: 240,
    });
    expect(
      clampMiniPlayerFrame(
        { x: 999, y: 999, width: 300 },
        {
          left: 0,
          top: 0,
          right: 120,
          bottom: 100,
        },
      ),
    ).toEqual({ x: 8, y: 33.5, width: 104 });
  });

  it("drags inside all four edges", () => {
    const frame = { x: 100, y: 100, width: 240 };
    const gesture = beginMiniPlayerGesture(
      [{ id: "7", x: 110, y: 110 }],
      frame,
    );
    expect(
      moveMiniPlayerGesture(
        gesture,
        [{ id: "7", x: -100, y: -100 }],
        frame,
        bounds,
      ).frame,
    ).toEqual({ x: 8, y: 8, width: 240 });
    expect(
      moveMiniPlayerGesture(
        gesture,
        [{ id: "7", x: 1000, y: 1000 }],
        frame,
        bounds,
      ).frame,
    ).toEqual({ x: 152, y: 657, width: 240 });
  });

  it("pinches around the fingers' focal point and preserves pointer identity across reordering", () => {
    const frame = { x: 100, y: 100, width: 200 };
    const gesture = beginMiniPlayerGesture(
      [
        { id: "1", x: 125, y: 156.25 },
        { id: "2", x: 175, y: 156.25 },
      ],
      frame,
    );
    const moved = moveMiniPlayerGesture(
      gesture,
      [
        { id: "2", x: 200, y: 156.25 },
        { id: "1", x: 100, y: 156.25 },
      ],
      frame,
      { ...bounds, right: 600 },
    );
    expect(moved.frame).toEqual({ x: 60, y: 55, width: 360 });
  });

  it("rebases when a second finger arrives or one lifts", () => {
    const frame = { x: 100, y: 100, width: 200 };
    const drag = beginMiniPlayerGesture([{ id: "1", x: 120, y: 120 }], frame);
    const two = [
      { id: "1", x: 130, y: 120 },
      { id: "2", x: 180, y: 120 },
    ];
    const pinchStart = moveMiniPlayerGesture(drag, two, frame, bounds);
    expect(pinchStart.frame).toEqual(frame);
    expect(pinchStart.gesture.kind).toBe("pinch");
    const one = moveMiniPlayerGesture(
      pinchStart.gesture,
      [two[0]!],
      frame,
      bounds,
    );
    expect(one.frame).toEqual(frame);
    expect(one.gesture.kind).toBe("drag");
    expect(
      moveMiniPlayerGesture(
        one.gesture,
        [{ id: "1", x: 140, y: 130 }],
        frame,
        bounds,
      ).frame,
    ).toEqual({ x: 110, y: 110, width: 200 });
  });
});
