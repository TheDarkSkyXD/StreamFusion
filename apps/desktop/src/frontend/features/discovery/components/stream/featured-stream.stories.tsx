import type { Meta, StoryObj } from "@storybook/react-vite";

import { makeStream, streamFixtures } from "../../../../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../../../../.storybook/story-router";
import { FeaturedStream } from "./featured-stream";

const meta = {
  title: "Components/Stream/FeaturedStream",
  component: FeaturedStream,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Home-page hero for one or more featured live streams, with platform-aware calls to action, optional preview audio, and manual carousel controls.",
      },
    },
  },
  args: {
    stream: makeStream(0),
    isLoading: false,
  },
} satisfies Meta<typeof FeaturedStream>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleTwitchStream: Story = {};

export const SingleKickStream: Story = {
  args: {
    stream: makeStream(1, {
      platform: "kick",
      title: "First playthrough, no spoilers please",
    }),
  },
};

export const Carousel: Story = {
  args: {
    stream: undefined,
    streams: streamFixtures.slice(0, 4),
  },
};

export const Loading: Story = {
  args: {
    stream: undefined,
    streams: undefined,
    isLoading: true,
  },
};

export const NoFeaturedStream: Story = {
  args: {
    stream: undefined,
    streams: [],
    isLoading: false,
  },
  render: (args) => (
    <div className="flex h-[560px] items-center justify-center border border-dashed border-[var(--color-border)] text-sm text-[var(--color-foreground-muted)]">
      <FeaturedStream {...args} />
      The component intentionally renders no hero when no stream is available.
    </div>
  ),
};
