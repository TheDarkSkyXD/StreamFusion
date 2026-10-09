import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Category } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";
import { View, useWindowDimensions } from "react-native";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type {
  DiscoverySession,
  PlatformReadOutcome,
} from "../capabilities/platform-reads";
import { CategoriesScreen } from "./categories-screen";

const PAGE_SIZE = 60;
const categories: readonly Category[] = Array.from(
  { length: 600 },
  (_, index) => {
    const number = index + 1;
    return {
      boxArtUrl: "",
      id: String(number),
      name: `Category ${String(number).padStart(3, "0")}`,
      platform: "twitch",
      viewerCount: 600 - index,
    };
  },
);

const preferences: DiscoveryPreferenceStore = {
  readLanguage: async () => "all",
  writeLanguage: async () => {},
  readClipTimeRange: async () => "all",
  writeClipTimeRange: async () => {},
};

function outcome(
  platform: Platform,
  items: readonly Category[],
  cursor?: string,
): PlatformReadOutcome<Category> {
  return {
    cache: { kind: "miss" },
    items,
    path: { kind: "guest", platform },
    platform,
    status: "complete",
    ...(cursor === undefined ? {} : { cursor }),
  };
}

async function unexpectedRead(): Promise<never> {
  throw new Error("Unexpected discovery read in categories scroll story");
}

const session: DiscoverySession = {
  async readCategories({ cursor, platform }) {
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    if (platform === "kick") return outcome(platform, []);
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= categories.length ||
      offset % PAGE_SIZE !== 0
    ) {
      throw new Error(`Unexpected category cursor: ${cursor}`);
    }
    const nextOffset = offset + PAGE_SIZE;
    return outcome(
      platform,
      categories.slice(offset, nextOffset),
      nextOffset < categories.length ? String(nextOffset) : undefined,
    );
  },
  async searchCategories({ platform, query }) {
    const matches =
      platform === "twitch"
        ? categories.filter((category) =>
            category.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
        : [];
    return outcome(platform, matches);
  },
  readTopStreams: unexpectedRead,
  readCategory: unexpectedRead,
  readCategoryStreams: unexpectedRead,
  readCategoryClips: unexpectedRead,
  readCategoryVideos: unexpectedRead,
  search: unexpectedRead,
  readChannel: unexpectedRead,
  readChannelVideos: unexpectedRead,
  readChannelClips: unexpectedRead,
};

function ReadyInfiniteCatalog(props: ComponentProps<typeof CategoriesScreen>) {
  const [queryClient] = useState(() => new QueryClient());
  const { height } = useWindowDimensions();
  return (
    <QueryClientProvider client={queryClient}>
      <View style={{ height, minHeight: 0, width: "100%" }}>
        <CategoriesScreen {...props} />
      </View>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Android/Discovery/Categories Scroll",
  component: CategoriesScreen,
  args: {
    onOpenAccounts: () => {},
    onOpenCategory: () => {},
    preferences,
    session,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CategoriesScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyInfinite: Story = {
  render: (args) => <ReadyInfiniteCatalog {...args} />,
};
