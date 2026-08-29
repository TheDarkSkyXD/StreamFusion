import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { KickVideoPlayer } from "./kick-video-player";

const meta = {
  title: "Components/Player/Kick/KickVideoPlayer",
  component: KickVideoPlayer,
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
          "The legacy Kick video orchestrator with Kick-branded controls. Stories use either no source or an inert local media fixture, never a live CDN URL.",
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
} satisfies Meta<typeof KickVideoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};

export const LoadingLocalFixture: Story = {
  args: {
    streamUrl: SAFE_PLAYER_MEDIA,
  },
};

export const TheaterShell: Story = {
  args: {
    isTheater: true,
  },
};
