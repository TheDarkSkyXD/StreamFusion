import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchVodHlsPlayer } from "./twitch-vod-hls-player";

const meta = {
  title: "Components/Player/Twitch/TwitchVodHlsPlayer",
  component: TwitchVodHlsPlayer,
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
          "The Twitch VOD media-engine boundary. Its empty catalog source renders the poster without contacting a media host.",
      },
    },
  },
  args: {
    src: "",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    currentLevel: "auto",
    onQualityLevels: fn(),
    onHlsInstance: fn(),
    onError: fn(),
  },
} satisfies Meta<typeof TwitchVodHlsPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PosterOnly: Story = {};
export const NativeControls: Story = { args: { controls: true } };
export const Unmuted: Story = { args: { muted: false } };
