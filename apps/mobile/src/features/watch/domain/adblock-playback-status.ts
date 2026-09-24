/**
 * Maps playlist-filter diagnostics (and optional native adsDetected) to the
 * desktop-equivalent "isShowingAd" signal for the Watch player shield.
 */
export function adsDetectedFromFilteringEvent(event: {
  readonly adsDetected?: boolean;
  readonly diagnostic: string;
}): boolean {
  if (typeof event.adsDetected === "boolean") {
    return event.adsDetected;
  }
  return adsDetectedFromFilteringDiagnostic(event.diagnostic);
}

export function adsDetectedFromFilteringDiagnostic(diagnostic: string): boolean {
  const text = diagnostic.trim();
  if (text.length === 0) return false;
  if (/no twitch ad markers/i.test(text)) return false;
  if (/filtering is off/i.test(text)) return false;
  if (/ads detected/i.test(text)) return true;
  if (/canary saw ad/i.test(text)) return true;
  if (/held unsafe/i.test(text)) return true;
  return false;
}

export type WatchAdBlockStatus = {
  readonly isActive: boolean;
  readonly isShowingAd: boolean;
};

export function watchAdBlockStatus(input: {
  readonly adsDetected: boolean;
  readonly filteringActive: boolean;
  readonly playlistProxyActive?: boolean;
}): WatchAdBlockStatus | null {
  const isActive = input.filteringActive || input.playlistProxyActive === true;
  if (!isActive) return null;
  return {
    isActive: true,
    isShowingAd: input.adsDetected,
  };
}
