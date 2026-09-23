/**
 * Color used for Android system chrome behind / under the bottom tab bar.
 * Keep in sync with `mobileColors.surface` (`#1a1a1a`) so Expo Go's
 * letterboxed nav strip and edge-to-edge under-nav region read as one piece
 * of tab chrome instead of a foreign black/gray band.
 */
export const ANDROID_SYSTEM_CHROME_COLOR = "#1a1a1a" as const;

/**
 * When safe-area bottom is already applied (edge-to-edge), the tab bar paints
 * the inset. When the RN window is letterboxed above the system nav
 * (`insetBottom === 0`), JS layout cannot fill that outside strip — native
 * root / navigation-bar chrome must use {@link ANDROID_SYSTEM_CHROME_COLOR}.
 */
export function androidBottomChromeReliesOnNativeWindow(
  insetBottom: number,
): boolean {
  return insetBottom <= 0;
}
