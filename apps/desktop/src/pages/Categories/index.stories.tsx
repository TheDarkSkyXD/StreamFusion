import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import { CATEGORY_KEYS } from "@/hooks/queries/useCategories";

import { withAppRouter } from "../../../.storybook/story-router";
import { CategoriesPage } from "./index";

const categoryFixtures: UnifiedCategory[] = [
  {
    id: "kick-just-chatting",
    platform: "kick",
    name: "Just Chatting",
    boxArtUrl: "",
    viewerCount: 184_200,
    tags: ["Social", "Community", "English"],
    slug: "just-chatting",
  },
  {
    id: "kick-valorant",
    platform: "kick",
    name: "VALORANT",
    boxArtUrl: "",
    viewerCount: 92_400,
    tags: ["Competitive", "FPS"],
    slug: "valorant",
  },
  {
    id: "kick-minecraft",
    platform: "kick",
    name: "Minecraft",
    boxArtUrl: "",
    viewerCount: 68_100,
    tags: ["Sandbox", "Survival"],
    slug: "minecraft",
  },
  {
    id: "kick-art",
    platform: "kick",
    name: "Art",
    boxArtUrl: "",
    viewerCount: 12_800,
    tags: ["Creative", "Drawing"],
    slug: "art",
  },
];

function createQueryClient(categories?: UnifiedCategory[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  if (categories) queryClient.setQueryData(CATEGORY_KEYS.top(), categories);
  return queryClient;
}

function installLoadingBridge(): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const pending = new Promise<never>(() => undefined);
  const categories = Object.assign(Object.create(previousBridge.categories), {
    getTop: () => pending,
  }) as typeof previousBridge.categories;
  const streams = Object.assign(Object.create(previousBridge.streams), {
    getTop: () => pending,
  }) as typeof previousBridge.streams;
  const bridge = Object.create(previousBridge) as typeof previousBridge;

  Object.defineProperties(bridge, {
    categories: { configurable: true, value: categories },
    streams: { configurable: true, value: streams },
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: bridge });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function CategoriesFixture({ categories }: { categories?: UnifiedCategory[] }) {
  const [queryClient] = useState(() => createQueryClient(categories));

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-[760px] min-w-[960px] overflow-hidden bg-[var(--color-background-primary)]">
        <CategoriesPage />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Categories",
  component: CategoriesPage,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The virtualized cross-platform category catalog. Stories use an isolated query cache and a local Electron bridge fixture, so the canvas never reads the network or desktop IPC.",
      },
    },
  },
} satisfies Meta<typeof CategoriesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: () => <CategoriesFixture categories={categoryFixtures} />,
};

export const Loading: Story = {
  beforeEach: installLoadingBridge,
  render: () => <CategoriesFixture />,
};

export const Empty: Story = {
  render: () => <CategoriesFixture categories={[]} />,
};
