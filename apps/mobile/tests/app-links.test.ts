import { describe, expect, it } from "vitest";

import type { ShellRestorationRepository } from "@mobile/capabilities/persistence";
import {
  applyShellStartupInputs,
  writeShellSnapshot,
} from "@mobile/features/shell/shell-lifecycle-controller";
import {
  createInitialShellNavigationState,
  getActiveShellLocation,
} from "@mobile/features/shell/shell-navigation";
import { parseAppLink } from "@mobile/transport/app-link-parser";

describe("allowlisted app links", () => {
  it("parses Activity and Watch destinations without carrying URLs upward", () => {
    expect(
      parseAppLink(
        "streamfusion-development://activity/device%3Amobile-ready%3Av1",
      ),
    ).toEqual({ kind: "activity-item", eventId: "device:mobile-ready:v1" });
    expect(
      parseAppLink(
        "streamfusion-development://watch/twitch/proofstreamer?channelId=channel-1",
      ),
    ).toEqual({
      kind: "watch-channel",
      platform: "twitch",
      channelId: "channel-1",
      channelLogin: "proofstreamer",
    });
  });

  it("rejects web URLs, credentials, unknown routes, extra fields, and malformed IDs", () => {
    const rejected = [
      "https://example.com/activity/event-1",
      "streamfusion-development://user:pass@activity/event-1",
      "streamfusion-development://moderation/ban",
      "streamfusion-development://activity/event-1?token=secret",
      "streamfusion-development://watch/twitch/name?channelId=id&url=https://example.com",
      "streamfusion-development://watch/unknown/name?channelId=id",
      "not a url",
    ];
    for (const value of rejected) expect(parseAppLink(value)).toBeNull();
  });

  it("applies an early user action after the initial deep link", () => {
    const state = applyShellStartupInputs(
      createInitialShellNavigationState(),
      [{ kind: "activity-item", eventId: "event:1" }],
      [{ type: "navigate", location: { route: "more/settings" } }],
    );
    expect(getActiveShellLocation(state)).toEqual({ route: "more/settings" });
    expect(state.histories.activity.trail).toEqual([
      { route: "activity/alert-preview", eventId: "event:1" },
    ]);
  });

  it("reports a restoration write failure without rejecting", async () => {
    const restoration: ShellRestorationRepository = {
      clear: () => Promise.resolve(),
      read: () => Promise.resolve(null),
      write: () => Promise.reject(new Error("unavailable")),
    };
    await expect(
      writeShellSnapshot(restoration, createInitialShellNavigationState(), 1),
    ).resolves.toBe(false);
  });
});
