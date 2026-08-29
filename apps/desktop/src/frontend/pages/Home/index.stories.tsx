import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withAppRouter } from "../../../../.storybook/story-router";
import { makeChannel } from "../../../../.storybook/catalog-fixtures";

import { HomePage } from "./index";
import { homeStreamFixtures } from "./story-fixtures";

type HomeQueryState = "populated" | "loading" | "empty" | "error";

function installHomeMocks(state: HomeQueryState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const streams = Object.create(previousBridge.streams) as typeof previousBridge.streams;
  const channels = Object.create(previousBridge.channels) as typeof previousBridge.channels;

  streams.getTop = async () => {
    if (state === "populated") return { success: true, data: homeStreamFixtures };
    if (state === "empty") return { success: true, data: [] };
    if (state === "error") {
      return { success: false, error: "Stream catalog is temporarily unavailable." };
    }

    return new Promise(() => undefined);
  };
  streams.getPlaybackUrl = async () => ({
    success: false,
    error: "Channel is offline in Storybook.",
  });
  channels.getByUsername = async ({ username, platform }) => {
    const streamIndex = homeStreamFixtures.findIndex(
      (stream) => stream.platform === platform && stream.channelName === username
    );
    const stream = homeStreamFixtures[streamIndex];
    if (!stream) return { success: false, error: "Channel fixture not found." };

    return {
      success: true,
      data: makeChannel(streamIndex, {
        id: stream.channelId,
        platform: stream.platform,
        username: stream.channelName,
        displayName: stream.channelDisplayName,
        avatarUrl: stream.channelAvatar,
        ...(stream.platform === "kick"
          ? {
              kickChannelId: `legacy-${stream.channelId}`,
              chatroomId: streamIndex + 1000,
              kickUserId: `user-${stream.channelId}`,
            }
          : {}),
      }),
    };
  };

  const bridge = Object.create(previousBridge) as typeof previousBridge;
  Object.defineProperty(bridge, "streams", { configurable: true, value: streams });
  Object.defineProperty(bridge, "channels", { configurable: true, value: channels });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: bridge });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function HomePageFixture({ state }: { state: HomeQueryState }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Home/HomePage",
  component: HomePage,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Landing page with an isolated top-streams fixture and in-memory router, covering supported catalog states without live network or IPC.",
      },
    },
  },
} satisfies Meta<typeof HomePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  beforeEach: () => installHomeMocks("populated"),
  render: () => <HomePageFixture state="populated" />,
};

export const Loading: Story = {
  beforeEach: () => installHomeMocks("loading"),
  render: () => <HomePageFixture state="loading" />,
};

export const Empty: Story = {
  beforeEach: () => installHomeMocks("empty"),
  render: () => <HomePageFixture state="empty" />,
};

export const ErrorFallback: Story = {
  beforeEach: () => installHomeMocks("error"),
  render: () => <HomePageFixture state="error" />,
};
