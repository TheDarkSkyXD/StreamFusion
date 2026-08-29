import { WifiOff } from "lucide-react";

import { VisuallyHidden } from "@/components/ui/visually-hidden";

interface NetworkStatusBannerProps {
  isOnline: boolean;
  isChecking: boolean;
  retryInSeconds: number | null;
  isTheaterModeActive?: boolean;
}

export function NetworkStatusBanner({
  isOnline,
  isChecking,
  retryInSeconds,
  isTheaterModeActive = false,
}: NetworkStatusBannerProps) {
  if (isOnline) return null;

  return (
    <>
      <div
        data-testid="network-status-card"
        aria-hidden="true"
        className={`pointer-events-none fixed left-4 z-[45] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-background-elevated)] p-3 text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] ${isTheaterModeActive ? "bottom-16" : "bottom-4"}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background-tertiary)] text-[var(--color-storm-accent)]">
            <WifiOff aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-5">No internet connection</p>
            <p className="mt-0.5 text-xs leading-4 text-[var(--color-foreground-secondary)]">
              StreamFusion needs internet to work.
            </p>
            {isChecking ? (
              <p className="mt-2 text-xs font-semibold leading-4 text-[var(--color-foreground-secondary)]">
                Checking connection…
              </p>
            ) : retryInSeconds !== null ? (
              <p className="mt-2 text-xs font-semibold leading-4 text-[var(--color-foreground-secondary)]">
                Trying again in <span className="tabular-nums">{retryInSeconds}</span>{" "}
                {retryInSeconds === 1 ? "second" : "seconds"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <VisuallyHidden role="status" aria-live="polite" aria-atomic="true">
        {isChecking
          ? "Checking internet connection."
          : "No internet connection. StreamFusion needs internet to work and will retry automatically."}
      </VisuallyHidden>
    </>
  );
}
