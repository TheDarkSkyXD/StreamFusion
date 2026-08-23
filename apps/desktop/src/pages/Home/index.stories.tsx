import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { withAppRouter } from "../../../.storybook/story-router";

import { HomePage } from "./index";
import { homeStreamFixtures } from "./story-fixtures";

type HomeQueryState = "populated" | "loading" | "empty" | "error";

function installHomeMocks(state: HomeQueryState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const streams = Object.create(previousBridge.streams) as typeof previousBridge.streams;

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

  const bridge = Object.create(previousBridge) as typeof previousBridge;
  Object.defineProperty(bridge, "streams", { configurable: true, value: streams });
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
