export type MiniPlayerFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
};

export type MiniPlayerBounds = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

export type MiniPlayerTouch = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
};

export type MiniPlayerGesture =
  | { readonly kind: "idle" }
  | {
      readonly kind: "drag";
      readonly pointerId: string;
      readonly anchor: MiniPlayerTouch;
      readonly frame: MiniPlayerFrame;
    }
  | {
      readonly kind: "pinch";
      readonly pointerIds: readonly [string, string];
      readonly midpoint: { readonly x: number; readonly y: number };
      readonly distance: number;
      readonly frame: MiniPlayerFrame;
    };

const ASPECT = 16 / 9;
const EDGE = 8;
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 144;
const MAX_WIDTH = 360;

export function miniPlayerHeight(width: number): number {
  return width / ASPECT;
}

function availableWidth(bounds: MiniPlayerBounds): number {
  return Math.max(
    0,
    Math.min(
      MAX_WIDTH,
      bounds.right - bounds.left - EDGE * 2,
      (bounds.bottom - bounds.top - EDGE * 2) * ASPECT,
    ),
  );
}

export function clampMiniPlayerFrame(
  frame: MiniPlayerFrame,
  bounds: MiniPlayerBounds,
): MiniPlayerFrame {
  const maximum = availableWidth(bounds);
  const width = Math.max(
    0,
    Math.min(maximum, Math.max(Math.min(MIN_WIDTH, maximum), frame.width)),
  );
  const height = miniPlayerHeight(width);
  const left = bounds.left + EDGE;
  const top = bounds.top + EDGE;
  return {
    x: Math.min(
      Math.max(frame.x, left),
      Math.max(left, bounds.right - EDGE - width),
    ),
    y: Math.min(
      Math.max(frame.y, top),
      Math.max(top, bounds.bottom - EDGE - height),
    ),
    width,
  };
}

export function initialMiniPlayerFrame(
  bounds: MiniPlayerBounds,
): MiniPlayerFrame {
  const width = Math.min(DEFAULT_WIDTH, availableWidth(bounds));
  return clampMiniPlayerFrame(
    {
      x: bounds.right - EDGE - width,
      y: bounds.bottom - EDGE - miniPlayerHeight(width),
      width,
    },
    bounds,
  );
}

export function beginMiniPlayerGesture(
  touches: readonly MiniPlayerTouch[],
  frame: MiniPlayerFrame,
): MiniPlayerGesture {
  if (touches.length >= 2) {
    const first = touches[0];
    const second = touches[1];
    if (!first || !second) return { kind: "idle" };
    return {
      kind: "pinch",
      pointerIds: [first.id, second.id],
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      frame,
    };
  }
  const first = touches[0];
  return first
    ? { kind: "drag", pointerId: first.id, anchor: first, frame }
    : { kind: "idle" };
}

export function moveMiniPlayerGesture(
  gesture: MiniPlayerGesture,
  touches: readonly MiniPlayerTouch[],
  currentFrame: MiniPlayerFrame,
  bounds: MiniPlayerBounds,
): { readonly frame: MiniPlayerFrame; readonly gesture: MiniPlayerGesture } {
  if (touches.length === 0)
    return { frame: currentFrame, gesture: { kind: "idle" } };
  if (gesture.kind === "drag" && touches.length === 1) {
    const touch = touches[0];
    if (touch?.id === gesture.pointerId) {
      return {
        frame: clampMiniPlayerFrame(
          {
            ...gesture.frame,
            x: gesture.frame.x + touch.x - gesture.anchor.x,
            y: gesture.frame.y + touch.y - gesture.anchor.y,
          },
          bounds,
        ),
        gesture,
      };
    }
  }
  if (gesture.kind === "pinch" && touches.length >= 2) {
    const first = touches.find((touch) => touch.id === gesture.pointerIds[0]);
    const second = touches.find((touch) => touch.id === gesture.pointerIds[1]);
    if (first && second && gesture.distance > 0) {
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const width = (gesture.frame.width * distance) / gesture.distance;
      const focalX =
        (gesture.midpoint.x - gesture.frame.x) / gesture.frame.width;
      const focalY =
        (gesture.midpoint.y - gesture.frame.y) /
        miniPlayerHeight(gesture.frame.width);
      const clampedWidth = Math.max(
        0,
        Math.min(
          availableWidth(bounds),
          Math.max(Math.min(MIN_WIDTH, availableWidth(bounds)), width),
        ),
      );
      return {
        frame: clampMiniPlayerFrame(
          {
            x: midpoint.x - focalX * clampedWidth,
            y: midpoint.y - focalY * miniPlayerHeight(clampedWidth),
            width: clampedWidth,
          },
          bounds,
        ),
        gesture,
      };
    }
  }
  return {
    frame: currentFrame,
    gesture: beginMiniPlayerGesture(touches, currentFrame),
  };
}
