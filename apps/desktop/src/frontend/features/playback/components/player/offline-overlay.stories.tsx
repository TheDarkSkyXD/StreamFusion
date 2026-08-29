import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";
import { OfflineOverlay } from "./offline-overlay";

const meta = {
  title: "Components/Player/OfflineOverlay",
  component: OfflineOverlay,
  decorators: [
    (Story) => (
      <div className="relative h-[405px] w-[720px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  args: {
    platform: "twitch",
    channelName: "novaarcade",
    displayName: "Nova Arcade",
    avatarUrl: SAFE_PLAYER_POSTER,
    bannerUrl: SAFE_PLAYER_POSTER,
    categoryName: "VALORANT",
    lastStreamTitle: "Road to radiant, calm comms and good decisions",
    onCheckAgain: fn(),
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A player-covering offline state. Stories use an inert inline image fixture so the catalog never fetches channel artwork.",
      },
    },
  },
} satisfies Meta<typeof OfflineOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLastStream: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Check Again" }));
    await expect(args.onCheckAgain).toHaveBeenCalledOnce();
  },
};

export const AvatarBackdrop: Story = {
  args: {
    platform: "kick",
    channelName: "pixelnomad",
    displayName: "Pixel Nomad",
    bannerUrl: undefined,
    categoryName: "Just Chatting",
    lastStreamTitle: "Building a tiny fantasy city",
  },
};

export const Compact: Story = {
  args: {
    compact: true,
    bannerUrl: undefined,
    categoryName: undefined,
    lastStreamTitle: undefined,
  },
};

export const NoArtwork: Story = {
  args: {
    avatarUrl: undefined,
    bannerUrl: undefined,
    categoryName: undefined,
    lastStreamTitle: undefined,
    statusMessage: "will be back soon",
  },
};
