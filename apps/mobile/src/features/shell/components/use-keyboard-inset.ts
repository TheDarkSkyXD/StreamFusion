import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, type KeyboardEvent } from "react-native";

import { keyboardOverlayInset } from "../domain/keyboard-overlay-inset";

export type KeyboardOverlayState = {
  readonly inset: number;
  readonly open: boolean;
};

/**
 * Tracks keyboard visibility and the *overlapping* inset only.
 * With Android `softwareKeyboardLayoutMode: "resize"`, the window often
 * shrinks after keyboardDidShow — recompute on Dimensions changes (and a
 * short trailing pass) so we do not keep a stale full-keyboard
 * paddingBottom under the Search dock.
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
      setState({
        open: true,
        inset: keyboardOverlayInset(
          Dimensions.get("window").height,
          screenY,
        ),
      });
    };

    const applyFrame = (event: KeyboardEvent) => {
      keyboardScreenYRef.current = event.endCoordinates.screenY;
      recompute();
      // adjustResize can update window height after the keyboard event.
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
