import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import type { CategoryMediaItem } from "@/hooks/queries/useCategoryMedia";

import { withAppRouter } from "../../../../.storybook/story-router";
import { CategoryMediaTab } from "./CategoryMediaTab";

const mediaFixtures: CategoryMediaItem[] = [
  {
    id: "twitch-clip-1",
    platform: "twitch",
    title: "The chat guessed the ending before I did",
    duration: "0:42",
    views: "184,200",
    viewCount: 184_200,
    publishedAt: "2026-08-09T20:30:00.000Z",
    thumbnailUrl: "",
    channelId: "nova-twitch",
    channelName: "novaarcade",
    channelDisplayName: "NovaArcade",
    channelAvatar: "",
    gameId: "twitch-just-chatting",
    gameName: "Just Chatting",
  },
  {
    id: "kick-clip-1",
    platform: "kick",
    title: "A tiny city gets its first train station",
    duration: "1:18",
    views: "92,600",
    viewCount: 92_600,
    publishedAt: "2026-08-08T18:15:00.000Z",
    thumbnailUrl: "",
    channelId: "mira-kick",
    channelName: "miramakes",
    channelDisplayName: "Mira Makes",
    channelAvatar: "",
    gameId: "kick-just-chatting",
    gameName: "Just Chatting",
  },
];

type FixtureMode = "populated" | "empty" | "loading" | "partial-failure";
type CategoryMediaResponse = { success: boolean; data?: CategoryMediaItem[]; error?: string };

function mediaResponse(
  mode: FixtureMode,
  platform: "twitch" | "kick"
): Promise<CategoryMediaResponse> {
  if (mode === "loading") return new Promise(() => undefined);
  if (mode === "partial-failure" && platform === "twitch") {
    return Promise.resolve({ success: false, error: "Twitch media is temporarily unavailable." });
  }
  return Promise.resolve({
    success: true,
    data: mode === "empty" ? [] : mediaFixtures.filter((item) => item.platform === platform),
  });
}

function installMediaBridge(mode: FixtureMode): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const clips = Object.assign(Object.create(previousBridge.clips), {
    getByCategory: ({ platform }: { platform: "twitch" | "kick" }) => mediaResponse(mode, platform),
    getPlaybackUrl: async () => ({
      success: false,
      error: "Clip playback is disabled in Storybook.",
    }),
  }) as typeof previousBridge.clips;
  const videos = Object.assign(Object.create(previousBridge.videos), {
    getByCategory: ({ platform }: { platform: "twitch" | "kick" }) => mediaResponse(mode, platform),
  }) as typeof previousBridge.videos;
  const bridge = Object.create(previousBridge) as typeof previousBridge;

  Object.defineProperties(bridge, {
    clips: { configurable: true, value: clips },
    videos: { configurable: true, value: videos },
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: bridge });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function CategoryMediaFixture({ kind }: { kind: "clips" | "videos" }) {
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
      <div className="min-h-[620px] min-w-[960px] bg-[var(--color-background-primary)] p-6">
        <CategoryMediaTab
          kind={kind}
          platformScope="all"
          twitchCategoryId="twitch-just-chatting"
          kickCategoryId="kick-just-chatting"
          kickCategorySlug="just-chatting"
          kickCategoryName="Just Chatting"
          direction="desc"
          timeRange="week"
          sort="views"
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Category Detail/Media Tab",
  component: CategoryMediaTab,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Category clips and videos merged across platforms. Each story installs an in-memory media bridge, so data, failure, and loading states are deterministic without playback, HLS, or desktop IPC.",
      },
    },
  },
  args: {
    kind: "clips",
    platformScope: "all",
    twitchCategoryId: "twitch-just-chatting",
    kickCategoryId: "kick-just-chatting",
    kickCategorySlug: "just-chatting",
    kickCategoryName: "Just Chatting",
    direction: "desc",
    timeRange: "week",
    sort: "views",
  },
} satisfies Meta<typeof CategoryMediaTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedClips: Story = {
  beforeEach: () => installMediaBridge("populated"),
  render: () => <CategoryMediaFixture kind="clips" />,
};

export const PopulatedVideos: Story = {
  beforeEach: () => installMediaBridge("populated"),
  render: () => <CategoryMediaFixture kind="videos" />,
};

export const Loading: Story = {
  beforeEach: () => installMediaBridge("loading"),
  render: () => <CategoryMediaFixture kind="clips" />,
};

export const Empty: Story = {
  beforeEach: () => installMediaBridge("empty"),
  render: () => <CategoryMediaFixture kind="clips" />,
};

export const PartialFailure: Story = {
  beforeEach: () => installMediaBridge("partial-failure"),
  render: () => <CategoryMediaFixture kind="clips" />,
};
