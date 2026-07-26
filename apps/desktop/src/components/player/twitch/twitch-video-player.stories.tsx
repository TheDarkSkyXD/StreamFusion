import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchVideoPlayer } from "./twitch-video-player";

const meta = {
  title: "Components/Player/Twitch/TwitchVideoPlayer",
  component: TwitchVideoPlayer,
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
          "The general Twitch playback shell. The local data fixture exercises its loading and error callback path without network or real media playback.",
      },
    },
  },
  args: {
    streamUrl: "",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    videoId: "",
    title: "Storybook Twitch broadcast",
    thumbnail: SAFE_PLAYER_POSTER,
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
    onToggleTheater: fn(),
  },
} satisfies Meta<typeof TwitchVideoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};
export const LoadingThenLocalMediaError: Story = {
  args: { streamUrl: SAFE_PLAYER_MEDIA },
};
export const TheaterShell: Story = { args: { isTheater: true } };
