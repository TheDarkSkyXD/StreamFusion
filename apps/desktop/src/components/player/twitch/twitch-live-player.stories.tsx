import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "../player-story-fixtures";
import { TwitchLivePlayer } from "./twitch-live-player";

const meta = {
  title: "Components/Player/Twitch/TwitchLivePlayer",
  component: TwitchLivePlayer,
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
          "Twitch live playback with ad-block status, captions, telemetry, refresh recovery, and live controls. Story sources are local and ad-block networking is disabled.",
      },
    },
  },
  args: {
    streamUrl: "",
    channelName: "novaarcade",
    poster: SAFE_PLAYER_POSTER,
    autoPlay: false,
    muted: true,
    enableAdBlock: false,
    onReady: fn(),
    onError: fn(),
    onQualityChange: fn(),
    onAdBlockStatusChange: fn(),
    onToggleTheater: fn(),
    onRefresh: fn(),
  },
} satisfies Meta<typeof TwitchLivePlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSource: Story = {};
export const LoadingThenLocalMediaError: Story = {
  args: { streamUrl: SAFE_PLAYER_MEDIA },
};
export const TheaterShell: Story = { args: { isTheater: true } };
