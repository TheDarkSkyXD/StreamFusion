import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { UnifiedChannel } from "@shared/platform-types";
import { useFollowStore } from "@/store/follow-store";
import { type LiveNotification, useNotificationStore } from "@/store/notification-store";

import { withAppRouter } from "../../../../../../.storybook/story-router";
import { NotificationsDropdown } from "./NotificationsDropdown";

const now = Date.now();

const notifications: LiveNotification[] = [
  {
    id: "notification-twitch-nova",
    platform: "twitch",
    channelId: "twitch-1842",
    channelName: "novaarcade",
    channelDisplayName: "novaarcade",
    channelAvatar: "",
    title: "Road to radiant, calm comms and good decisions",
    createdAt: now - 45_000,
  },
  {
    id: "notification-kick-pixel",
    platform: "kick",
    channelId: "kick-7421",
    channelName: "pixelnomad",
    channelDisplayName: "Pixel Nomad",
    channelAvatar: "",
    title: "Late-night ranked with the community",
    createdAt: now - 72 * 60_000,
    readAt: now - 60 * 60_000,
  },
];

const followedChannels: UnifiedChannel[] = [
  {
    id: "twitch-1842",
    platform: "twitch",
    username: "novaarcade",
    displayName: "Nova Arcade",
    avatarUrl: "",
    bio: "",
    isLive: true,
    isVerified: true,
    isPartner: true,
  },
];

function withNotifications(items: LiveNotification[]): Decorator {
  return (Story) => {
    useNotificationStore.setState({ notifications: items });
    useFollowStore.setState({
      localFollows: followedChannels,
      sourceByKey: new Map(),
    });
    return <Story />;
  };
}

async function openDropdown(canvasElement: HTMLElement) {
  const trigger = canvasElement.querySelector<HTMLButtonElement>('button[title="Notifications"]');
  trigger?.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

const meta = {
  title: "Components/Top Navigation/NotificationsDropdown",
  component: NotificationsDropdown,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The live-channel inbox with unread count, identity resolution from followed channels, relative times, and bulk actions.",
      },
    },
  },
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="flex min-h-[420px] w-[400px] max-w-[calc(100vw-2rem)] justify-end pt-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationsDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithNotifications: Story = {
  decorators: [withNotifications(notifications)],
  play: ({ canvasElement }) => openDropdown(canvasElement),
};

export const Empty: Story = {
  decorators: [withNotifications([])],
  play: ({ canvasElement }) => openDropdown(canvasElement),
};

export const UnreadOverflow: Story = {
  decorators: [
    withNotifications(
      Array.from({ length: 105 }, (_, index) => ({
        ...notifications[0],
        id: `notification-${index}`,
        createdAt: now - index * 60_000,
      }))
    ),
  ],
};
