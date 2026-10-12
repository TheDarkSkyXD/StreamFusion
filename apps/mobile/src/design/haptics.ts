import { AccessibilityInfo } from "react-native";

import { getPlatformModule } from "../../modules/streamfusion-native-contracts/src/platform";

let reduceMotionCached: boolean | null = null;

async function mayHaptic(): Promise<boolean> {
  if (reduceMotionCached === null) {
    reduceMotionCached = await AccessibilityInfo.isReduceMotionEnabled();
    AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      reduceMotionCached = enabled;
    });
  }
  return !reduceMotionCached;
}

async function perform(kind: "selection" | "light" | "medium" | "warning"): Promise<void> {
  try {
    if (await mayHaptic()) await getPlatformModule().performHaptic(kind);
  } catch {
    return;
  }
}

export function selectionHaptic(): Promise<void> {
  return perform("selection");
}

export function impactHaptic(style: "light" | "medium" = "light"): Promise<void> {
  return perform(style);
}

export function warningHaptic(): Promise<void> {
  return perform("warning");
}
