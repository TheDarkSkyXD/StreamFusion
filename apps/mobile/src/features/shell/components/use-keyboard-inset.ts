import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";

import { keyboardOverlayInset } from "../domain/keyboard-overlay-inset";

export type KeyboardOverlayState = {
  readonly inset: number;
  readonly open: boolean;
};

/**
 * Tracks keyboard visibility and the *overlapping* inset only.
 *
 * Android uses `softwareKeyboardLayoutMode: "resize"` (app.json): the window
 * already shrinks under the IME. Dimensions often still report the pre-keyboard
 * height (or settle late), so overlap padding would double-space the Search
 * dock. On Android we only track `open` (for hiding tabs) and keep inset at 0.
 * iOS still pads by true keyboard overlap.
 */
export function useKeyboardInset(): KeyboardOverlayState {
  const [state, setState] = useState<KeyboardOverlayState>({
    inset: 0,
    open: false,
  });
  const keyboardScreenYRef = useRef<number | null>(null);

  useEffect(() => {
    let trailingPass: ReturnType<typeof setTimeout> | undefined;

    const recompute = () => {
      const screenY = keyboardScreenYRef.current;
      if (screenY === null) {
        setState({ inset: 0, open: false });
        return;
      }
      // Never pad keyboard overlay on Android resize — window already shrinks.
      const inset =
        Platform.OS === "android"
          ? 0
          : keyboardOverlayInset(Dimensions.get("window").height, screenY);
      setState({ open: true, inset });
    };

    const applyFrame = (event: KeyboardEvent) => {
      keyboardScreenYRef.current = event.endCoordinates.screenY;
      recompute();
      if (Platform.OS === "android") {
        return;
      }
      // iOS / pan: trailing pass if Dimensions lag the keyboard event.
      if (trailingPass !== undefined) {
        clearTimeout(trailingPass);
      }
      trailingPass = setTimeout(recompute, 64);
    };

    const hide = () => {
      keyboardScreenYRef.current = null;
      if (trailingPass !== undefined) {
        clearTimeout(trailingPass);
        trailingPass = undefined;
      }
      setState({ inset: 0, open: false });
    };

    const subscriptions = [
      Keyboard.addListener("keyboardDidShow", applyFrame),
      Keyboard.addListener("keyboardDidChangeFrame", applyFrame),
      Keyboard.addListener("keyboardDidHide", hide),
      Dimensions.addEventListener("change", recompute),
    ];
    return () => {
      if (trailingPass !== undefined) {
        clearTimeout(trailingPass);
      }
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    };
  }, []);

  return state;
}
