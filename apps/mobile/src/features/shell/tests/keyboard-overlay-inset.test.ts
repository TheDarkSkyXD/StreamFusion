import { describe, expect, it } from "vitest";

import {
  keyboardOverlayInset,
  safeFrameBottomInset,
} from "../domain/keyboard-overlay-inset";

// Guards: search dock only pads by the keyboard overlap so adjustResize windows are not double-spaced
describe("keyboard overlay inset", () => {
  it("pads by the overlapping keyboard height", () => {
    expect(keyboardOverlayInset(2072, 1180)).toBe(892);
  });

  it("does not pad when the window already sits above the keyboard", () => {
    expect(keyboardOverlayInset(1180, 1180)).toBe(0);
    expect(keyboardOverlayInset(1100, 1180)).toBe(0);
  });

  it("ignores empty keyboard frames", () => {
    expect(keyboardOverlayInset(2072, 0)).toBe(0);
  });

  it("pads the safe frame by keyboard overlap unless picture-in-picture is active", () => {
    expect(
      safeFrameBottomInset({
        fallbackInset: 24,
        keyboardInset: 892,
        pictureInPicture: false,
      }),
    ).toBe(892);
    expect(
      safeFrameBottomInset({
        fallbackInset: 24,
        keyboardInset: 0,
        pictureInPicture: false,
      }),
    ).toBe(24);
    expect(
      safeFrameBottomInset({
        fallbackInset: 24,
        keyboardInset: 892,
        pictureInPicture: true,
      }),
    ).toBe(0);
  });

  it("skips keyboard overlay padding when applyKeyboardOverlay is false (Android resize)", () => {
    expect(
      safeFrameBottomInset({
        applyKeyboardOverlay: false,
        fallbackInset: 0,
        keyboardInset: 549,
        pictureInPicture: false,
      }),
    ).toBe(0);
    expect(
      safeFrameBottomInset({
        applyKeyboardOverlay: false,
        fallbackInset: 24,
        keyboardInset: 549,
        pictureInPicture: false,
      }),
    ).toBe(24);
  });
});
