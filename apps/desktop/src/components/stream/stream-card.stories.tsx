import type { Meta, StoryObj } from "@storybook/react-vite";

import { makeStream } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { StreamCard } from "./stream-card";

const meta = {
  title: "Components/Stream/StreamCard",
  component: StreamCard,
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A live-stream tile with platform identity, audience metadata, channel verification, tags, and a distinct currently-watching state.",
      },
    },
  },
  args: {
    stream: makeStream(0),
    showCategory: true,
    isWatching: false,
  },
} satisfies Meta<typeof StreamCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Kick: Story = {
  args: {
    stream: makeStream(1, {
      platform: "kick",
      channelIsVerified: true,
      viewerCount: 12_840,
    }),
  },
};

export const CurrentlyWatching: Story = {
  args: {
    isWatching: true,
  },
};

export const CompactMetadata: Story = {
  args: {
    stream: makeStream(2, {
      language: "",
      tags: [],
    }),
    showCategory: false,
  },
};

export const ThumbnailFallback: Story = {
  args: {
    stream: makeStream(3, {
      title: "The stream continues while the thumbnail recovers",
      thumbnailUrl: "",
    }),
  },
};
