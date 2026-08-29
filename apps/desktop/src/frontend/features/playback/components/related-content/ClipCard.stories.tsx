import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ClipCard } from "./ClipCard";
import { makeClip, relatedChannel } from "./related-content-story-fixtures";
import { RelatedContentStoryRouter } from "./related-content-story-router";

const meta = {
  title: "Components/Stream/Related Content/Clip Card",
  component: ClipCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <RelatedContentStoryRouter>
        <div className="w-80">
          <Story />
        </div>
      </RelatedContentStoryRouter>
    ),
  ],
  args: {
    clip: makeClip(0),
    onClick: fn(),
    platform: "twitch",
    channelName: "novaarcade",
    channelData: relatedChannel,
  },
} satisfies Meta<typeof ClipCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongTitle: Story = {
  args: {
    clip: makeClip(1, {
      title: "A perfectly timed final-round play that had the entire chat holding its breath",
    }),
  },
};

export const MissingChannelArtwork: Story = {
  args: {
    clip: makeClip(2, { channelAvatar: null }),
    channelData: null,
  },
};
