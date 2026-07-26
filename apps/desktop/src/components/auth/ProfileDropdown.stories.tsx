import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { KickUser, TwitchUser } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { withAppRouter } from "../../../.storybook/story-router";
import { ProfileDropdown } from "./ProfileDropdown";

const twitchUser: TwitchUser = {
  id: "twitch-1842",
  login: "novaarcade",
  displayName: "Nova Arcade",
  profileImageUrl: "",
  createdAt: "2021-04-18T16:30:00.000Z",
  broadcasterType: "partner",
};

const kickUser: KickUser = {
  id: 7421,
  username: "NovaArcade",
  slug: "novaarcade",
  profilePic: "",
  verified: true,
};

function withProfile(platforms: Array<"twitch" | "kick">): Decorator {
  return (Story) => {
    const twitchConnected = platforms.includes("twitch");
    const kickConnected = platforms.includes("kick");
    useAuthStore.setState({
      twitchConnected,
      kickConnected,
      twitchLoading: false,
      kickLoading: false,
      twitchUser: twitchConnected ? twitchUser : null,
      kickUser: kickConnected ? kickUser : null,
      isGuest: platforms.length === 0,
      initialized: true,
    });
    return <Story />;
  };
}

async function openDropdown(canvasElement: HTMLElement) {
  canvasElement.querySelector<HTMLButtonElement>("button")?.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const meta = {
  title: "Components/Auth/ProfileDropdown",
  component: ProfileDropdown,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The profile and account-management menu for guest, single-platform, and multi-platform identities.",
      },
    },
  },
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="flex min-h-[520px] w-[380px] max-w-[calc(100vw-2rem)] justify-end pt-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProfileDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Guest: Story = {
  decorators: [withProfile([])],
  play: ({ canvasElement }) => openDropdown(canvasElement),
};

export const TwitchConnected: Story = {
  decorators: [withProfile(["twitch"])],
  play: ({ canvasElement }) => openDropdown(canvasElement),
};

export const BothConnected: Story = {
  decorators: [withProfile(["twitch", "kick"])],
  play: ({ canvasElement }) => openDropdown(canvasElement),
};
