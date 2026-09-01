import { describe, expect, it } from "vitest";

import { parseKickRaidNotification } from "@backend/services/chat/kick-parser";
import { parseTwitchRaidNotification } from "@backend/services/chat/twitch-hermes-client";

const twitchSource = {
  platform: "twitch",
  channelId: "source-1",
  channelSlug: "source",
} as const;
const kickSource = {
  platform: "kick",
  broadcasterUserId: "source-2",
  channelSlug: "source",
} as const;

// Guards: proprietary raid frames must become typed same-platform events before reaching React.
// Guards: recognized malformed contracts must fail closed instead of starting or launching a raid.
// Guards: Kick target viewer counts must never be normalized as raid-party members.
describe("outgoing raid boundary parsers", () => {
  it("normalizes Twitch update and source-scoped go frames", () => {
    const update = parseTwitchRaidNotification(
      {
        type: "raid_update_v2",
        raid: {
          id: "raid-1",
          target_id: "target-1",
          target_login: "target",
          target_display_name: "Target",
          target_profile_image: "https://example.com/target.png",
          viewer_count: 42,
        },
      },
      twitchSource,
      1_000
    );
    expect(update).toMatchObject({
      kind: "event",
      event: {
        phase: "offer",
        offer: {
          sessionId: "raid-1",
          audience: { kind: "raid-party", count: 42 },
          progress: { kind: "waiting" },
          launchAuthority: { kind: "provider-go" },
        },
      },
    });

    expect(
      parseTwitchRaidNotification({ type: "raid_go_v2", data: {} }, twitchSource, 2_000, "raid-1")
    ).toEqual({
      kind: "event",
      event: { phase: "go", source: twitchSource, sessionId: "raid-1", occurredAt: 2_000 },
    });
  });

  it("distinguishes ignored frames from recognized malformed Twitch contracts", () => {
    expect(
      parseTwitchRaidNotification({ type: "prediction_update", data: {} }, twitchSource, 1_000)
    ).toEqual({ kind: "ignored" });
    expect(
      parseTwitchRaidNotification(
        {
          type: "raid_update_v2",
          raid: {
            id: "raid-1",
            target_login: "target",
            target_display_name: "Target",
            viewer_count: -1,
          },
        },
        twitchSource,
        1_000
      )
    ).toEqual({ kind: "contract-mismatch" });
    expect(
      parseTwitchRaidNotification({ type: "raid_go_v2", data: {} }, twitchSource, 1_000)
    ).toEqual({ kind: "contract-mismatch" });
  });

  it("normalizes Twitch's profile-image template and rejects unsafe targets", () => {
    const normalized = parseTwitchRaidNotification(
      {
        type: "raid_update_v2",
        raid: {
          id: "raid-2",
          target_login: "safe_target",
          target_display_name: "Safe Target",
          target_profile_image: "https://example.com/profile_image-%s.png",
        },
      },
      twitchSource,
      1_000
    );
    expect(normalized).toMatchObject({
      kind: "event",
      event: {
        offer: {
          target: { avatarUrl: "https://example.com/profile_image-300x300.png" },
        },
      },
    });

    expect(
      parseTwitchRaidNotification(
        {
          type: "raid_update_v2",
          raid: {
            id: "raid-3",
            target_login: "../settings",
            target_display_name: "Unsafe",
          },
        },
        twitchSource,
        1_000
      )
    ).toEqual({ kind: "contract-mismatch" });
  });

  it("normalizes Kick chat move with an absolute eight-second deadline", () => {
    const result = parseKickRaidNotification(
      "App\\Events\\ChatMoveToSupportedChannelEvent",
      {
        hosted: {
          slug: "target",
          username: "Target",
          profile_pic: "https://example.com/kick-target.png",
          viewers_count: 1_234,
        },
      },
      kickSource,
      5_000,
      "kick-raid-1"
    );

    expect(result).toMatchObject({
      kind: "event",
      event: {
        phase: "offer",
        offer: {
          audience: { kind: "target-viewers", count: 1_234 },
          progress: { kind: "timed", startedAt: 5_000, endsAt: 13_000 },
          launchAuthority: { kind: "deadline", deadlineAt: 13_000 },
        },
      },
    });
  });

  it("rejects malformed Kick hosted data and ignores unrelated events", () => {
    expect(
      parseKickRaidNotification(
        "App\\Events\\ChatMoveToSupportedChannelEvent",
        { hosted: { slug: "target", username: "Target", viewers_count: -5 } },
        kickSource,
        0,
        "kick-raid-1"
      )
    ).toEqual({ kind: "contract-mismatch" });
    expect(
      parseKickRaidNotification("App\\Events\\StreamHostedEvent", {}, kickSource, 0, "ignored")
    ).toEqual({ kind: "ignored" });
  });
});
