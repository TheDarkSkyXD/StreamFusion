import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickVodPlayer } from "./kick-vod-player";

const meta = {
  title: "Components/Player/Kick/KickVodPlayer",
  component: KickVodPlayer,
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
          "Kick archived-video playback with timed text, seek previews, resume support, and VOD controls. Media fixtures are local and inert.",
      },
    },
  },
  args: {
    streamUrl: "",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    videoId: "",
    title: "Storybook archived broadcast",
    thumbnail: SAFE_PLAYER_POSTER,
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
    onToggleTheater: fn(),
  },
} satisfies Meta<typeof KickVodPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};
export const LoadingLocalFixture: Story = {
  args: { streamUrl: SAFE_PLAYER_MEDIA },
};
export const TheaterShell: Story = {
  args: { isTheater: true },
};
