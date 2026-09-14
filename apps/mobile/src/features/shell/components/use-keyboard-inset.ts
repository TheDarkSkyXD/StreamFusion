import { useEffect, useState } from "react";
import { Dimensions, Keyboard, type KeyboardEvent } from "react-native";

import { keyboardOverlayInset } from "../domain/keyboard-overlay-inset";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const applyFrame = (event: KeyboardEvent) => {
      setInset(
        keyboardOverlayInset(
          Dimensions.get("window").height,
          event.endCoordinates.screenY,
        ),
      );
    };
    const subscriptions = [
      Keyboard.addListener("keyboardDidShow", applyFrame),
      Keyboard.addListener("keyboardDidChangeFrame", applyFrame),
      Keyboard.addListener("keyboardDidHide", () => {
        setInset(0);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    };
  }, []);
  return inset;
}
