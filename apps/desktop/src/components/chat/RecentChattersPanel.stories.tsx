import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { DEFAULT_USER_PREFERENCES } from "../../shared/auth-types";
import type { ChatKnownUser } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useChatStore } from "../../store/chat-store";
import { TWITCH_BADGE, TWITCH_CHANNEL_KEY } from "./chat-story-fixtures";
import { RecentChattersPanel } from "./RecentChattersPanel";

const PANEL_ID = "storybook-recent-chatters";

const EMPTY_CHATTERS: Record<string, ChatKnownUser> = {};

const POPULATED_CHATTERS: Record<string, ChatKnownUser> = {
  novaarcade: {
    userId: "broadcaster-1",
    username: "novaarcade",
    displayName: "NovaArcade",
    color: "#a970ff",
    role: "broadcaster",
    badges: [],
    lastSeen: new Date("2026-07-26T20:05:00.000Z"),
  },
  modmira: {
    userId: "moderator-1",
    username: "modmira",
    displayName: "ModMira",
    color: "#00ad03",
    role: "moderator",
    badges: [TWITCH_BADGE],
    lastSeen: new Date("2026-07-26T20:04:00.000Z"),
  },
  pixelpatron: {
    userId: "subscriber-1",
    username: "pixelpatron",
    displayName: "PixelPatron",
    color: "#f472b6",
    role: "subscriber",
    badges: [],
    lastSeen: new Date("2026-07-26T20:03:00.000Z"),
  },
  viewerone: {
    userId: "viewer-1",
    username: "viewerone",
    displayName: "ViewerOne",
    color: "#38bdf8",
    role: "viewer",
    badges: [],
    lastSeen: new Date("2026-07-26T20:02:00.000Z"),
  },
  viewertwo: {
    userId: "viewer-2",
    username: "viewertwo",
    displayName: "ViewerTwo",
    role: "viewer",
    badges: [],
    lastSeen: new Date("2026-07-26T20:01:00.000Z"),
  },
};

function installChatters(
  chatters: Record<string, ChatKnownUser>,
  trackedTotal?: number
): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousChatState = useChatStore.getState();

  useAuthStore.setState({
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      chatDisplay: {
        ...DEFAULT_USER_PREFERENCES.chatDisplay,
        readableColorForUncolored: true,
        themeAdaptUsernameColor: true,
      },
    },
  });
  useChatStore.setState({
    usersByChannel: { [TWITCH_CHANNEL_KEY]: chatters },
    chatterCountByChannel: trackedTotal === undefined ? {} : { [TWITCH_CHANNEL_KEY]: trackedTotal },
  });

  return () => {
    useChatStore.setState(previousChatState, true);
    useAuthStore.setState(previousAuthState, true);
  };
}

const meta = {
  title: "Components/Chat/RecentChattersPanel",
  component: RecentChattersPanel,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="relative h-[540px] w-[380px] overflow-hidden rounded-lg border border-[#333333] bg-[#171717] text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    id: PANEL_ID,
    channelKey: TWITCH_CHANNEL_KEY,
    onClose: fn(),
  },
} satisfies Meta<typeof RecentChattersPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  beforeEach: () => installChatters(EMPTY_CHATTERS),
};

export const Populated: Story = {
  beforeEach: () => installChatters(POPULATED_CHATTERS, 36),
};

export const CollapsedModeratorGroup: Story = {
  beforeEach: () => installChatters(POPULATED_CHATTERS, 36),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const moderators = canvas.getByRole("button", { name: "Moderators, 1 chatter" });

    await userEvent.click(moderators);

    await expect(moderators).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByRole("list", { name: "Moderators" })).not.toBeVisible();
  },
};

export const CloseWithEscape: Story = {
  beforeEach: () => installChatters(POPULATED_CHATTERS, 36),
  play: async ({ args }) => {
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalled();
  },
};
