import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ClipDialog } from "./ClipDialog";
import { makeClip, relatedChannel } from "./related-content-story-fixtures";
import { RelatedContentStoryRouter } from "./related-content-story-router";

const meta = {
  title: "Components/Stream/Related Content/Clip Dialog",
  component: ClipDialog,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <RelatedContentStoryRouter>
        <Story />
      </RelatedContentStoryRouter>
    ),
  ],
  args: {
    selectedClip: makeClip(0),
    onClose: fn(),
    clipLoading: false,
    clipError: null,
    clipPlaybackUrl: null,
    platform: "twitch",
    channelName: "novaarcade",
    channelData: relatedChannel,
    onPlaybackError: fn(),
  },
} satisfies Meta<typeof ClipDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchEmbedFallback: Story = {};

export const Loading: Story = {
  args: { clipLoading: true },
};

export const KickError: Story = {
  args: {
    selectedClip: makeClip(1, { vodId: "991188" }),
    platform: "kick",
    channelData: { ...relatedChannel, platform: "kick" },
    clipError: "The clip media URL expired. Try reopening the clip.",
  },
};

export const MetadataUnavailable: Story = {
  args: {
    selectedClip: makeClip(2, {
      category: undefined,
      gameName: undefined,
      views: "",
      date: "",
      created_at: undefined,
      vodId: undefined,
    }),
    channelData: null,
  },
};
