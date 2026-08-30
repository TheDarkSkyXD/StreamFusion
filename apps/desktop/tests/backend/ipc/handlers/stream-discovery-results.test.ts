import { describe, expect, it } from "vitest";

import { settleStreamProviders } from "@backend/ipc/handlers/stream-discovery-results";
import type { UnifiedStream } from "@shared/platform-types";

const twitchStream = { id: "t1", platform: "twitch", viewerCount: 10 } as UnifiedStream;
const kickStream = { id: "k1", platform: "kick", viewerCount: 20 } as UnifiedStream;

// Guards: provider outages remain distinguishable from complete empty discovery results.
// Guards: partial and stale data preserve their provider coverage across IPC.
describe("settleStreamProviders", () => {
  it("returns a failure when every requested provider failed", () => {
    expect(
      settleStreamProviders(["twitch", "kick"], [
        { platform: "twitch", status: "failed", data: [], error: "Twitch unavailable" },
        { platform: "kick", status: "failed", data: [], error: "Kick unavailable" },
      ])
    ).toEqual({
      success: false,
      error: "Twitch unavailable; Kick unavailable",
      providers: { twitch: "failed", kick: "failed" },
    });
  });

  it("returns explicit partial coverage when one provider succeeds", () => {
    expect(
      settleStreamProviders(["twitch", "kick"], [
        { platform: "twitch", status: "failed", data: [], error: "Twitch unavailable" },
        { platform: "kick", status: "complete", data: [kickStream] },
      ])
    ).toEqual({
      success: true,
      data: [kickStream],
      providers: { twitch: "failed", kick: "complete" },
    });
  });

  it("keeps stale cached data marked stale", () => {
    expect(
      settleStreamProviders(["kick"], [
        { platform: "kick", status: "stale", data: [kickStream] },
      ])
    ).toEqual({
      success: true,
      data: [kickStream],
      platform: "kick",
      providers: { kick: "stale" },
    });
  });

  it("sorts combined provider data and applies the requested limit", () => {
    expect(
      settleStreamProviders(
        ["twitch", "kick"],
        [
          { platform: "twitch", status: "complete", data: [twitchStream] },
          { platform: "kick", status: "complete", data: [kickStream] },
        ],
        1
      )
    ).toMatchObject({ success: true, data: [kickStream] });
  });
});
