import type { ChatPlatform } from "./chat-types";

export const RAID_CONTRACT_PROFILES = {
  twitch: {
    id: "twitch-raid-v2-2026-09-01",
    platform: "twitch",
    observedAt: "2026-09-01",
    provenance: "observed-first-party-client",
  },
  kick: {
    id: "kick-chat-move-2026-09-01",
    platform: "kick",
    observedAt: "2026-09-01",
    provenance: "observed-first-party-client",
  },
} as const satisfies Record<ChatPlatform, RaidContractProfile>;

export interface RaidContractProfile {
  id: string;
  platform: ChatPlatform;
  observedAt: string;
  provenance: "observed-first-party-client";
}

export interface TwitchRaidSource {
  platform: "twitch";
  channelId: string;
  channelSlug: string;
}

export interface KickRaidSource {
  platform: "kick";
  broadcasterUserId: string;
  channelSlug: string;
}

export type RaidSource = TwitchRaidSource | KickRaidSource;

export interface TwitchRaidTarget {
  platform: "twitch";
  channelId?: string;
  channelSlug: string;
  displayName: string;
  avatarUrl?: string;
}

export interface KickRaidTarget {
  platform: "kick";
  channelId?: string;
  channelSlug: string;
  displayName: string;
  avatarUrl?: string;
}

export type RaidTarget = TwitchRaidTarget | KickRaidTarget;

export type RaidAudience =
  | { kind: "raid-party"; count: number }
  | { kind: "target-viewers"; count: number }
  | { kind: "unknown" };

export type RaidProgress =
  | { kind: "waiting" }
  | {
      kind: "timed";
      startedAt: number;
      endsAt: number;
      provenance: "platform-payload" | "observed-first-party-client";
    };

export type RaidLaunchAuthority =
  | { kind: "provider-go" }
  | {
      kind: "deadline";
      deadlineAt: number;
      provenance: "observed-first-party-client";
    };

interface RaidOfferBase<P extends ChatPlatform> {
  sessionId: string;
  platform: P;
  audience: RaidAudience;
  progress: RaidProgress;
  launchAuthority: RaidLaunchAuthority;
  receivedAt: number;
  contract: RaidContractProfile & { platform: P };
}

export type TwitchRaidOffer = RaidOfferBase<"twitch"> & {
  source: TwitchRaidSource;
  target: TwitchRaidTarget;
};

export type KickRaidOffer = RaidOfferBase<"kick"> & {
  source: KickRaidSource;
  target: KickRaidTarget;
};

export type RaidOffer = TwitchRaidOffer | KickRaidOffer;

export type RaidHandoffEvent =
  | { phase: "offer"; offer: RaidOffer }
  | { phase: "cancel"; source: RaidSource; sessionId: string; occurredAt: number }
  | { phase: "go"; source: RaidSource; sessionId: string; occurredAt: number }
  | { phase: "signal-lost"; source: RaidSource; occurredAt: number };

export type RaidParticipation = "joining" | "staying";

export type RaidHandoffState =
  | { status: "idle" }
  | { status: "pending"; offer: RaidOffer; participation: RaidParticipation }
  | { status: "settled"; sessionId: string; outcome: "joined"; target: RaidTarget }
  | {
      status: "settled";
      sessionId: string;
      outcome: "cancelled" | "stayed" | "signal-lost" | "source-changed";
    };

export function raidSourcesMatch(left: RaidSource, right: RaidSource): boolean {
  if (left.platform !== right.platform) return false;

  if (left.platform === "twitch" && right.platform === "twitch") {
    return (
      left.channelId === right.channelId &&
      normalizeRaidChannelSlug(left.channelSlug) === normalizeRaidChannelSlug(right.channelSlug)
    );
  }

  if (left.platform === "kick" && right.platform === "kick") {
    return (
      left.broadcasterUserId === right.broadcasterUserId &&
      normalizeRaidChannelSlug(left.channelSlug) === normalizeRaidChannelSlug(right.channelSlug)
    );
  }

  return false;
}

export function normalizeRaidChannelSlug(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

export function isValidRaidChannelSlug(value: string): boolean {
  return /^[a-z0-9_-]{1,64}$/i.test(value.trim());
}
