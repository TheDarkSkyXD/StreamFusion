import type { Meta, StoryObj } from "@storybook/react-vite";

import { PlatformAvatar } from "./platform-avatar";

const avatarImage = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <rect width="160" height="160" fill="#252525"/>
    <circle cx="80" cy="60" r="30" fill="#a0a0a0"/>
    <path d="M28 150c4-34 24-52 52-52s48 18 52 52" fill="#a0a0a0"/>
  </svg>
`)}`;

const meta = {
  title: "Components/UI/PlatformAvatar",
  component: PlatformAvatar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A channel avatar with platform identity and optional live status. Platform borders identify the source without dominating the surrounding UI.",
      },
    },
  },
  args: {
    src: avatarImage,
    alt: "River Arcade",
    platform: "twitch",
    size: "w-16 h-16",
    isLive: false,
    liveStatusType: "dot",
    disablePlatformBorder: false,
  },
  argTypes: {
    platform: {
      control: "inline-radio",
      options: ["twitch", "kick"],
    },
    liveStatusType: {
      control: "inline-radio",
      options: ["dot", "badge"],
    },
  },
} satisfies Meta<typeof PlatformAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const PlatformBorders: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      <div className="grid justify-items-center gap-3">
        <PlatformAvatar src={avatarImage} alt="Twitch channel" platform="twitch" size="w-16 h-16" />
        <span className="text-xs text-[var(--color-foreground-secondary)]">Twitch</span>
      </div>
      <div className="grid justify-items-center gap-3">
        <PlatformAvatar src={avatarImage} alt="Kick channel" platform="kick" size="w-16 h-16" />
        <span className="text-xs text-[var(--color-foreground-secondary)]">Kick</span>
      </div>
    </div>
  ),
};

export const LiveStates: Story = {
  render: () => (
    <div className="flex items-center gap-10 pb-3">
      <PlatformAvatar
        src={avatarImage}
        alt="Twitch channel live with a status dot"
        platform="twitch"
        size="w-16 h-16"
        isLive
      />
      <PlatformAvatar
        src={avatarImage}
        alt="Kick channel live with a badge"
        platform="kick"
        size="w-20 h-20"
        isLive
        liveStatusType="badge"
      />
    </div>
  ),
};

export const InitialFallback: Story = {
  args: {
    src: null,
    alt: "Nova",
    platform: "kick",
  },
};

export const Neutral: Story = {
  args: {
    disablePlatformBorder: true,
  },
};
