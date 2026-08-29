import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickLivePlayer } from "./kick-live-player";

const meta = {
  title: "Components/Player/Kick/KickLivePlayer",
  component: KickLivePlayer,
  decorators: [
    (Story) => (
      <div className="aspect-video w-[800px] overflow-hidden rounded-xl bg-black">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Kick live playback with loading, captions, DVR-aware progress, and shared controls. The loading story uses an inert local media fixture and never contacts a CDN.",
      },
    },
  },
  args: {
    streamUrl: "",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    channelName: "pixelnomad",
    title: "Late-night ranked with the community",
    startedAt: new Date(Date.now() - 3_840_000).toISOString(),
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
    onToggleTheater: fn(),
    onRefresh: fn(),
  },
} satisfies Meta<typeof KickLivePlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};

export const LoadingLocalFixture: Story = {
  args: {
    streamUrl: SAFE_PLAYER_MEDIA,
  },
};

export const TheaterShell: Story = {
  args: { isTheater: true },
};
