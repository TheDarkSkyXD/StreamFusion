import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef } from "react";
import { usePipStore } from "@/store/pip-store";
import { withAppRouter } from "../../../.storybook/story-router";

import { MiniPlayer } from "./mini-player";
import { SAFE_PLAYER_MEDIA, SAFE_PLAYER_POSTER } from "./player-story-fixtures";

function MiniPlayerFixture() {
  const originalApiRef = useRef(window.electronAPI);
  const storyApi = useMemo(
    () =>
      new Proxy(originalApiRef.current, {
        get(target, property, receiver) {
          if (property === "streams") {
            return {
              getPlaybackUrl: async () => ({
                success: true,
                data: {
                  url: SAFE_PLAYER_MEDIA,
                  format: "mp4",
                },
              }),
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    []
  );

  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: storyApi,
  });

  useEffect(() => {
    const originalApi = originalApiRef.current;
    usePipStore.setState({
      currentStream: {
        platform: "kick",
        channelName: "pixelnomad",
        channelDisplayName: "Pixel Nomad",
        channelAvatar: SAFE_PLAYER_POSTER,
        streamUrl: SAFE_PLAYER_MEDIA,
        title: "Late-night ranked with the community",
        categoryName: "Just Chatting",
        viewerCount: 12_840,
      },
      isPipActive: true,
      isOnStreamPage: false,
    });

    return () => {
      usePipStore.setState({
        currentStream: null,
        isPipActive: false,
        isOnStreamPage: false,
      });
      Object.defineProperty(window, "electronAPI", {
        configurable: true,
        value: originalApi,
      });
    };
  }, []);

  return <MiniPlayer />;
}

const meta = {
  title: "Components/Player/MiniPlayer",
  component: MiniPlayer,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The draggable persistent live-player surface. This story resets its PiP store and resolves an inert local media fixture instead of a live CDN URL.",
      },
    },
  },
  render: () => (
    <div className="relative h-[640px] min-w-[900px] bg-[#0f0f0f]">
      <MiniPlayerFixture />
    </div>
  ),
} satisfies Meta<typeof MiniPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveKickStream: Story = {};
