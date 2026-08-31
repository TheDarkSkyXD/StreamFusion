import type {
  ChannelIdentity,
  ChannelRef,
  Platform,
} from "@core/platform/index.ts";
import type { SafeAppError } from "@core/reliability/index.ts";

export const platformFixtures = {
  twitch: "twitch",
  kick: "kick",
  twitchChannelById: { kind: "id", value: "71092938" },
  kickChannelBySlug: { kind: "slug", value: "xqc" },
  kickChannelByLegacyId: {
    platform: "kick",
    id: "421500",
    username: "xQc",
  },
  kickChannelByOfficialId: {
    platform: "kick",
    id: "411439",
    username: "XQC",
  },
} as const satisfies {
  twitch: Platform;
  kick: Platform;
  twitchChannelById: ChannelRef;
  kickChannelBySlug: ChannelRef;
  kickChannelByLegacyId: ChannelIdentity;
  kickChannelByOfficialId: ChannelIdentity;
};

export const reliabilityFixtures = {
  rateLimitedError: {
    code: "rate_limited",
    retry: { kind: "after", retryAtMs: 1_800_000_000_000 },
    diagnosticId: "bfbb7fa2-51cd-493e-86dc-ad98bd876e52",
    platform: "twitch",
  },
  terminalError: {
    code: "forbidden",
    retry: { kind: "none" },
    diagnosticId: "bd1a2d14-4675-4397-afaf-690b840d8023",
  },
} as const satisfies Record<string, SafeAppError>;
