import { useCallback, useRef } from "react";

/**
 * Sticky-dismiss gate for the viewer prediction widget.
 *
 * The widget is "sticky-dismissed" — once a user closes a prediction banner
 * we suppress every subsequent update for the *same* prediction id (so
 * ACTIVE → LOCKED → RESOLVED status flips don't re-open the banner the
 * user just closed). The first time a *different* prediction id arrives,
 * the suppression clears so the new prediction renders normally.
 *
 * Both TwitchChat and KickChat consumed this pattern inline before;
 * extracting it removes the duplicated ref logic and makes the rule
 * unit-testable in one place.
 */
export interface StickyDismissedPrediction {
  /** Returns true when this prediction id should be ignored. */
  shouldSuppress: (predictionId: string) => boolean;
  /** Marks a prediction id as user-dismissed for future updates. */
  dismiss: (predictionId: string) => void;
}

export function useStickyDismissedPrediction(): StickyDismissedPrediction {
  const dismissedIdRef = useRef<string | null>(null);

  const shouldSuppress = useCallback((predictionId: string): boolean => {
    if (dismissedIdRef.current === predictionId) return true;
    if (dismissedIdRef.current !== null) {
      dismissedIdRef.current = null;
    }
    return false;
  }, []);

  const dismiss = useCallback((predictionId: string): void => {
    dismissedIdRef.current = predictionId;
  }, []);

  return { shouldSuppress, dismiss };
}
