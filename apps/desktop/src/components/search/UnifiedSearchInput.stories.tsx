import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { userEvent, within } from "storybook/test";

import type { UnifiedCategory, UnifiedChannel } from "@/backend/api/unified/platform-types";
import { UnifiedSearchInput } from "./UnifiedSearchInput";

const channels: UnifiedChannel[] = [
  {
    id: "nova-twitch",
    platform: "twitch",
    username: "novaarcade",
    displayName: "NovaArcade",
    avatarUrl:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=96&h=96&q=85",
    isLive: true,
    isVerified: true,
    isPartner: true,
    followerCount: 385_000,
  },
  {
    id: "nova-kick",
    platform: "kick",
    username: "novabuilds",
    displayName: "NovaBuilds",
    avatarUrl:
      "https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=96&h=96&q=85",
    isLive: false,
    isVerified: false,
    isPartner: false,
    followerCount: 42_800,
  },
];

const categories: UnifiedCategory[] = [
  {
    id: "just-chatting",
    platform: "twitch",
    name: "Just Chatting",
    boxArtUrl:
      "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=96&h=128&q=80",
    viewerCount: 184_000,
    tags: ["Social"],
  },
  {
    id: "minecraft",
    platform: "kick",
    name: "Minecraft",
    boxArtUrl:
      "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=96&h=128&q=80",
    viewerCount: 92_000,
    tags: ["Sandbox"],
  },
];

function SearchFixtureProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
        },
      },
    });
    const envelope = <T,>(platform: "twitch" | "kick", data: T[]) => ({
      pages: [
        {
          success: true,
          sessionId: "storybook-search",
          platform,
          status: "exhausted" as const,
          retryable: false,
          error: null,
          data,
          cursor: null,
        },
      ],
      pageParams: [undefined],
    });

    for (const platform of ["twitch", "kick"] as const) {
      client.setQueryData(
        ["search", "channels", "nova", platform, false, 50],
        envelope(
          platform,
          channels.filter((channel) => channel.platform === platform)
        )
      );
      client.setQueryData(
        ["search", "categories", "mine", platform, 20],
        envelope(
          platform,
          categories.filter((category) => category.platform === platform)
        )
      );
    }

    return client;
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const meta = {
  title: "Components/Search/UnifiedSearchInput",
  component: UnifiedSearchInput,
  decorators: [
    (Story) => (
      <SearchFixtureProvider>
        <div className="w-[620px] min-h-[420px]">
          <Story />
        </div>
      </SearchFixtureProvider>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Cross-platform typeahead for channels, categories, and live streams. Focus the field to reveal scoped history and result tabs.",
      },
    },
  },
  args: {
    placeholder: "Search streams, channels, categories...",
    showCategories: true,
    onSelectChannel: () => undefined,
    onSelectCategory: () => undefined,
    onSearch: () => undefined,
  },
  argTypes: {
    platform: { control: "inline-radio", options: [undefined, "twitch", "kick"] },
  },
} satisfies Meta<typeof UnifiedSearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Resting: Story = {};

export const RecentSearches: Story = {
  render: (args) => {
    localStorage.setItem(
      "streamfusion_search_history",
      JSON.stringify({
        channels: ["NovaArcade", "RiftRunner", "MiraMakes"],
        categories: ["Just Chatting"],
        streams: ["cozy building"],
      })
    );
    return <UnifiedSearchInput {...args} />;
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("textbox"));
  },
};

export const ChannelResults: Story = {
  args: {
    initialValue: "nova",
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("textbox"));
  },
};

export const CategoryResults: Story = {
  args: {
    initialValue: "mine",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("textbox"));
    await userEvent.click(canvas.getByRole("tab", { name: "Categories" }));
  },
};

export const LiveChannelPicker: Story = {
  args: {
    initialValue: "nova",
    platform: "twitch",
    placeholder: "Add a live Twitch channel",
    showCategories: false,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("textbox"));
  },
};
