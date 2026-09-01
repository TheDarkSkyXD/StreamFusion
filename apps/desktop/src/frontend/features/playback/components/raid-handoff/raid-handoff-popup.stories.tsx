import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RAID_CONTRACT_PROFILES } from "@shared/raid-handoff-types";

import { RaidHandoffPopup } from "./raid-handoff-popup";

const avatarImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%239146ff'/%3E%3Ccircle cx='48' cy='38' r='18' fill='white'/%3E%3Cpath d='M18 88c3-20 14-30 30-30s27 10 30 30' fill='white'/%3E%3C/svg%3E";

const twitchOffer = {
  sessionId: "story-twitch",
  platform: "twitch",
  source: { platform: "twitch", channelId: "1", channelSlug: "source" },
  target: {
    platform: "twitch",
    channelId: "2",
    channelSlug: "target",
    displayName: "TargetStreamer",
    avatarUrl: avatarImage,
  },
  audience: { kind: "raid-party", count: 842 },
  progress: { kind: "waiting" },
  launchAuthority: { kind: "provider-go" },
  receivedAt: 0,
  contract: RAID_CONTRACT_PROFILES.twitch,
} as const;

const meta = {
  title: "Features/Playback/RaidHandoffPopup",
  component: RaidHandoffPopup,
  decorators: [
    (Story) => (
      <div className="relative h-[405px] w-[720px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  args: {
    model: {
      offer: twitchOffer,
      participation: "joining",
      audienceText: "842 joining the raid",
      stayHere: fn(),
      joinRaid: fn(),
    },
  },
} satisfies Meta<typeof RaidHandoffPopup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchWaiting: Story = {};

export const StayedWithRejoin: Story = {
  args: { model: { ...meta.args.model, participation: "staying" } },
};

export const KickCountdown: Story = {
  args: {
    model: {
      ...meta.args.model,
      offer: {
        sessionId: "story-kick",
        platform: "kick",
        source: { platform: "kick", broadcasterUserId: "1", channelSlug: "source" },
        target: { platform: "kick", channelSlug: "target", displayName: "TargetStreamer" },
        audience: { kind: "target-viewers", count: 12_304 },
        progress: {
          kind: "timed",
          startedAt: 0,
          endsAt: 8_000,
          provenance: "observed-first-party-client",
        },
        launchAuthority: {
          kind: "deadline",
          deadlineAt: 8_000,
          provenance: "observed-first-party-client",
        },
        receivedAt: 0,
        contract: RAID_CONTRACT_PROFILES.kick,
      },
      audienceText: "12,304 watching TargetStreamer now",
      remainingMs: 4_000,
      progressPercent: 50,
    },
  },
};
