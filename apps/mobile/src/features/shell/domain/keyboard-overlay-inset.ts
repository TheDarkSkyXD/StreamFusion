export function keyboardOverlayInset(
  windowHeight: number,
  keyboardScreenY: number,
): number {
  if (keyboardScreenY <= 0 || windowHeight <= 0) {
    return 0;
  }
  return Math.max(0, windowHeight - keyboardScreenY);
}

export function safeFrameBottomInset(input: {
  readonly fallbackInset: number;
  readonly keyboardInset: number;
  readonly pictureInPicture: boolean;
  /**
   * Android `softwareKeyboardLayoutMode: "resize"` already shrinks the window.
   * Pass false so we never double-pad with a stale overlay inset.
   * iOS (pan) still needs overlap padding — leave true / omit.
   */
  readonly applyKeyboardOverlay?: boolean;
}): number {
  if (input.pictureInPicture) {
    return 0;
  }
  if (input.applyKeyboardOverlay !== false && input.keyboardInset > 0) {
    return input.keyboardInset;
  }
  return input.fallbackInset;
}
