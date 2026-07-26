import type { Meta, StoryObj } from "@storybook/react-vite";
import { makeVideo, relatedChannel } from "./related-content-story-fixtures";
import { RelatedContentStoryRouter } from "./related-content-story-router";
import { VideoCard } from "./VideoCard";

const meta = {
  title: "Components/Stream/Related Content/Video Card",
  component: VideoCard,
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
    video: makeVideo(0),
    platform: "twitch",
    channelName: "novaarcade",
    channelData: relatedChannel,
  },
} satisfies Meta<typeof VideoCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Archived: Story = {};

export const Live: Story = {
  args: {
    video: makeVideo(1, { isLive: true, duration: "0:00", source: undefined }),
  },
};

export const SubscriberOnly: Story = {
  args: {
    video: makeVideo(2, { isSubOnly: true }),
  },
};

export const KickSubscriberOnly: Story = {
  args: {
    platform: "kick",
    video: makeVideo(3, { isSubOnly: true, platform: "kick" }),
    channelData: { ...relatedChannel, platform: "kick" },
  },
};
