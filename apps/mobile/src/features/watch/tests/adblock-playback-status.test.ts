import { describe, expect, it } from "vitest";

import {
  adsDetectedFromFilteringDiagnostic,
  adsDetectedFromFilteringEvent,
  watchAdBlockStatus,
} from "../domain/adblock-playback-status";

describe("adsDetectedFromFilteringDiagnostic", () => {
  it("treats clean playlists as not showing ads", () => {
    expect(
      adsDetectedFromFilteringDiagnostic("No Twitch ad markers in this playlist."),
    ).toBe(false);
    expect(adsDetectedFromFilteringDiagnostic("Filtering is off.")).toBe(false);
  });

  it("detects strip and canary ad diagnostics", () => {
    expect(
      adsDetectedFromFilteringDiagnostic(
        "Ads detected; held without media (desktop unsafe-hold, no backup).",
      ),
    ).toBe(true);
    expect(
      adsDetectedFromFilteringDiagnostic(
        "Canary saw ad markers and kept the original playlist.",
      ),
    ).toBe(true);
    expect(
      adsDetectedFromFilteringDiagnostic(
        "Filter failed; held unsafe media (fail-closed).",
      ),
    ).toBe(true);
  });
});

describe("adsDetectedFromFilteringEvent", () => {
  it("prefers the native adsDetected flag when present", () => {
    expect(
      adsDetectedFromFilteringEvent({
        adsDetected: false,
        diagnostic: "Ads detected; held without media.",
      }),
    ).toBe(false);
    expect(
      adsDetectedFromFilteringEvent({
        adsDetected: true,
        diagnostic: "No Twitch ad markers in this playlist.",
      }),
    ).toBe(true);
  });
});

describe("watchAdBlockStatus", () => {
  it("hides the shield unless filtering or playlist proxy is active", () => {
    expect(
      watchAdBlockStatus({ adsDetected: true, filteringActive: false }),
    ).toBeNull();
    expect(
      watchAdBlockStatus({
        adsDetected: false,
        filteringActive: true,
      }),
    ).toEqual({ isActive: true, isShowingAd: false });
    expect(
      watchAdBlockStatus({
        adsDetected: true,
        filteringActive: false,
        playlistProxyActive: true,
      }),
    ).toEqual({ isActive: true, isShowingAd: true });
  });
});
