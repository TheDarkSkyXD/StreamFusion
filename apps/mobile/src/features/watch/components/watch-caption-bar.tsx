import type { WatchCaptionEligibility } from "../domain/watch-captions";

export type WatchCaptionBarProps = {
  readonly compact?: boolean;
  readonly eligibility: WatchCaptionEligibility;
  readonly busy?: boolean;
  readonly model?: unknown;
  readonly onInstall?: () => void;
  readonly onRemove?: () => void;
  readonly onStart?: () => void;
  readonly onStop?: () => void;
  readonly session?: unknown;
  readonly status?: string | null;
};

/** Player CC chrome hidden — no Coming soon, install, or disabled CC control. */
export function WatchCaptionBar(_props: WatchCaptionBarProps) {
  return null;
}
