/**
 * Meaningful outcome haptics only (play/pause, follow, clear, successful refresh).
 * Lazy-loads expo-haptics and skips when reduce-motion is enabled.
 */

type HapticsModule = {
  readonly selectionAsync: () => Promise<void>;
  readonly impactAsync: (style: unknown) => Promise<void>;
  readonly notificationAsync: (type: unknown) => Promise<void>;
  readonly ImpactFeedbackStyle: { readonly Light: unknown; readonly Medium: unknown };
  readonly NotificationFeedbackType: { readonly Warning: unknown };
};

let hapticsModule: HapticsModule | null | undefined;
let reduceMotionCached: boolean | null = null;

async function loadHaptics(): Promise<HapticsModule | null> {
  if (hapticsModule !== undefined) return hapticsModule;
  try {
    hapticsModule = (await import("expo-haptics")) as HapticsModule;
  } catch {
    hapticsModule = null;
  }
  return hapticsModule;
}

async function mayHaptic(): Promise<boolean> {
  if (reduceMotionCached === true) return false;
  if (reduceMotionCached === null) {
    try {
      const { AccessibilityInfo } = await import("react-native");
      reduceMotionCached =
        (await AccessibilityInfo.isReduceMotionEnabled?.()) ?? false;
      AccessibilityInfo.addEventListener?.("reduceMotionChanged", (enabled) => {
        reduceMotionCached = enabled;
      });
    } catch {
      reduceMotionCached = false;
    }
  }
  return reduceMotionCached !== true;
}

/** Light selection feedback for successful refresh / toggle outcomes. */
export async function selectionHaptic(): Promise<void> {
  if (!(await mayHaptic())) return;
  const Haptics = await loadHaptics();
  if (!Haptics) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // Expo Go / web / missing native module — ignore.
  }
}

/** Soft impact for play/pause and follow/unfollow. */
export async function impactHaptic(
  style: "light" | "medium" = "light",
): Promise<void> {
  if (!(await mayHaptic())) return;
  const Haptics = await loadHaptics();
  if (!Haptics) return;
  try {
    await Haptics.impactAsync(
      style === "medium"
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {
    // ignore
  }
}

/** Noticeable feedback for clear / destructive confirms. */
export async function warningHaptic(): Promise<void> {
  if (!(await mayHaptic())) return;
  const Haptics = await loadHaptics();
  if (!Haptics) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // ignore
  }
}
