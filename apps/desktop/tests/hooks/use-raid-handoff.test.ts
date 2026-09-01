import { describe, expect, it } from "vitest";

import { reduceRaidHandoff } from "@/features/playback/data/use-raid-handoff";
import {
  RAID_CONTRACT_PROFILES,
  type KickRaidOffer,
  type RaidHandoffState,
  type RaidOffer,
  type TwitchRaidOffer,
} from "@shared/raid-handoff-types";

const twitchOffer: TwitchRaidOffer = {
  sessionId: "twitch-raid-1",
  platform: "twitch",
  source: { platform: "twitch", channelId: "1", channelSlug: "source" },
  target: { platform: "twitch", channelId: "2", channelSlug: "target", displayName: "Target" },
  audience: { kind: "raid-party", count: 10 },
  progress: { kind: "waiting" },
  launchAuthority: { kind: "provider-go" },
  receivedAt: 1_000,
  contract: RAID_CONTRACT_PROFILES.twitch,
};

const kickOffer: KickRaidOffer = {
  sessionId: "kick-raid-1",
  platform: "kick",
  source: { platform: "kick", broadcasterUserId: "3", channelSlug: "source" },
  target: { platform: "kick", channelSlug: "target", displayName: "Target" },
  audience: { kind: "target-viewers", count: 100 },
  progress: {
    kind: "timed",
    startedAt: 1_000,
    endsAt: 9_000,
    provenance: "observed-first-party-client",
  },
  launchAuthority: {
    kind: "deadline",
    deadlineAt: 9_000,
    provenance: "observed-first-party-client",
  },
  receivedAt: 1_000,
  contract: RAID_CONTRACT_PROFILES.kick,
};

function offerState(offer: RaidOffer = twitchOffer): RaidHandoffState {
  return reduceRaidHandoff(
    { status: "idle" },
    { type: "provider", event: { phase: "offer", offer } }
  );
}

// Guards: every new raid defaults to joining while Stay here remains reversible until launch.
// Guards: Twitch only settles on its correlated go frame and Kick only settles at its absolute deadline.
// Guards: source mismatches, duplicate terminal events, and signal loss never launch an unrelated stream.
describe("raid handoff reducer", () => {
  it("defaults to joining and preserves stay across a duplicate update", () => {
    const initial = offerState();
    expect(initial).toMatchObject({ status: "pending", participation: "joining" });
    const staying = reduceRaidHandoff(initial, { type: "participation", value: "staying" });
    const updated = reduceRaidHandoff(staying, {
      type: "provider",
      event: {
        phase: "offer",
        offer: { ...twitchOffer, audience: { kind: "raid-party", count: 12 } },
      },
    });
    expect(updated).toMatchObject({
      status: "pending",
      participation: "staying",
      offer: { audience: { count: 12 } },
    });
    expect(reduceRaidHandoff(updated, { type: "participation", value: "joining" })).toMatchObject({
      status: "pending",
      participation: "joining",
    });
  });

  it("waits for Twitch go and makes duplicate go idempotent", () => {
    const pending = offerState();
    expect(
      reduceRaidHandoff(pending, {
        type: "deadline",
        sessionId: twitchOffer.sessionId,
        occurredAt: 99_000,
      })
    ).toEqual(pending);
    const joined = reduceRaidHandoff(pending, {
      type: "provider",
      event: {
        phase: "go",
        source: twitchOffer.source,
        sessionId: twitchOffer.sessionId,
        occurredAt: 2_000,
      },
    });
    expect(joined).toMatchObject({ status: "settled", outcome: "joined" });
    expect(
      reduceRaidHandoff(joined, {
        type: "provider",
        event: {
          phase: "go",
          source: twitchOffer.source,
          sessionId: twitchOffer.sessionId,
          occurredAt: 2_001,
        },
      })
    ).toEqual(joined);
  });

  it("launches Kick at the absolute deadline but ignores an early tick", () => {
    const pending = offerState(kickOffer);
    expect(
      reduceRaidHandoff(pending, {
        type: "deadline",
        sessionId: kickOffer.sessionId,
        occurredAt: 8_999,
      })
    ).toEqual(pending);
    expect(
      reduceRaidHandoff(pending, {
        type: "deadline",
        sessionId: kickOffer.sessionId,
        occurredAt: 9_000,
      })
    ).toMatchObject({ status: "settled", outcome: "joined" });
  });

  it("ignores a source mismatch and settles safely on signal loss", () => {
    const pending = offerState();
    const mismatched = reduceRaidHandoff(pending, {
      type: "provider",
      event: {
        phase: "go",
        source: { ...twitchOffer.source, channelId: "different" },
        sessionId: twitchOffer.sessionId,
        occurredAt: 2_000,
      },
    });
    expect(mismatched).toEqual(pending);
    expect(
      reduceRaidHandoff(pending, {
        type: "provider",
        event: { phase: "signal-lost", source: twitchOffer.source, occurredAt: 2_000 },
      })
    ).toMatchObject({ status: "settled", outcome: "signal-lost" });
  });
});
