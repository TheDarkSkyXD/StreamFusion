import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import type { UnifiedCategory, UnifiedStream } from "@/backend/api/unified/platform-types";
import { CATEGORY_KEYS } from "@/hooks/queries/useCategories";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { validateCategoryDetailSearch } from "@/routes/category-detail-search";

import { CategoryDetailPage } from "./index";

const twitchCategory: UnifiedCategory = {
  id: "twitch-just-chatting",
  platform: "twitch",
  name: "Just Chatting",
  boxArtUrl: "",
  viewerCount: 192_400,
  tags: ["Social", "English"],
};

const kickCategory: UnifiedCategory = {
  id: "kick-just-chatting",
  platform: "kick",
  name: "Just Chatting",
  boxArtUrl: "",
  viewerCount: 61_900,
  tags: ["Community", "English"],
  slug: "just-chatting",
};

const streamFixtures: UnifiedStream[] = [
  {
    id: "twitch-nova-live",
    platform: "twitch",
    channelId: "nova-twitch",
    channelName: "novaarcade",
    channelDisplayName: "NovaArcade",
    channelAvatar: "",
    title: "Late-night community chat and creative challenges",
    viewerCount: 48_200,
    thumbnailUrl: "",
    isLive: true,
    startedAt: "2026-08-10T17:00:00.000Z",
    language: "en",
    tags: ["Community", "English"],
    categoryId: twitchCategory.id,
    categoryName: twitchCategory.name,
  },
  {
    id: "kick-mira-live",
    platform: "kick",
    channelId: "mira-kick",
    channelName: "miramakes",
    channelDisplayName: "Mira Makes",
    channelAvatar: "",
    title: "Building a tiny fantasy city with chat",
    viewerCount: 21_600,
    thumbnailUrl: "",
    isLive: true,
    startedAt: "2026-08-10T18:30:00.000Z",
    language: "en",
    tags: ["Creative", "Cozy"],
    categoryId: kickCategory.id,
    categoryName: kickCategory.name,
  },
];

type FixtureMode = "populated" | "empty" | "loading" | "unavailable";

function installDetailBridge(mode: FixtureMode): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const pending = new Promise<never>(() => undefined);
  const categories = Object.assign(Object.create(previousBridge.categories), {
    getById: () => pending,
    search: () => pending,
  }) as typeof previousBridge.categories;
  const streams = Object.assign(Object.create(previousBridge.streams), {
    getByCategory: ({ platform }: { platform: "twitch" | "kick" }) => {
      if (mode !== "unavailable") return pending;
      if (platform === "twitch") {
        return Promise.resolve({ error: "Twitch is temporarily unavailable." });
      }
      return Promise.resolve({
        data: streamFixtures.filter((stream) => stream.platform === "kick"),
        cursor: undefined,
      });
    },
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

function createDetailQueryClient(mode: FixtureMode) {
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

  if (mode === "loading") return queryClient;

  queryClient.setQueryData(CATEGORY_KEYS.byId(twitchCategory.id, "twitch"), twitchCategory);
  queryClient.setQueryData(CATEGORY_KEYS.byId(kickCategory.id, "kick"), kickCategory);

  if (mode !== "unavailable") {
    const pages = (items: UnifiedStream[]) => ({
      pages: [{ data: items, nextCursor: undefined }],
      pageParams: [undefined],
    });
    const data = mode === "empty" ? [] : streamFixtures;
    queryClient.setQueryData(
      [
        ...STREAM_KEYS.byCategory(twitchCategory.id, "twitch"),
        "infinite",
        undefined,
        undefined,
        "all:::desc",
      ],
      pages(data.filter((stream) => stream.platform === "twitch"))
    );
    queryClient.setQueryData(
      [
        ...STREAM_KEYS.byCategory(kickCategory.id, "kick"),
        "infinite",
        kickCategory.name,
        undefined,
        "all:::desc",
      ],
      pages(data.filter((stream) => stream.platform === "kick"))
    );
  }

  return queryClient;
}

function CategoryDetailStoryRouter({
  initialPath,
  children,
}: {
  initialPath: string;
  children: ReactNode;
}) {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({ component: Outlet });
    const appRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_app",
      component: Outlet,
    });
    const categoryRoute = createRoute({
      getParentRoute: () => appRoute,
      path: "/categories/$platform/$categoryId",
      validateSearch: validateCategoryDetailSearch,
      component: () => <>{children}</>,
    });

    return createRouter({
      routeTree: rootRoute.addChildren([appRoute.addChildren([categoryRoute])]),
      history: createMemoryHistory({ initialEntries: [initialPath] }),
      defaultPendingMinMs: 0,
    });
  }, [children, initialPath]);

  return <RouterProvider router={router} />;
}

function CategoryDetailFixture({ mode }: { mode: FixtureMode }) {
  const [queryClient] = useState(() => createDetailQueryClient(mode));
  const search =
    mode === "unavailable"
      ? "?platform=twitch&otherId=kick-just-chatting"
      : "?otherId=kick-just-chatting";

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-[900px] min-w-[1100px] overflow-auto bg-[var(--color-background-primary)]">
        <CategoryDetailStoryRouter initialPath={`/categories/twitch/twitch-just-chatting${search}`}>
          <CategoryDetailPage />
        </CategoryDetailStoryRouter>
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Category Detail",
  component: CategoryDetailPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Cross-platform category browsing with a route-faithful in-memory router, isolated query cache, and local Electron bridge fixture. No canvas state contacts Twitch, Kick, or desktop IPC.",
      },
    },
  },
} satisfies Meta<typeof CategoryDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedLive: Story = {
  beforeEach: () => installDetailBridge("populated"),
  render: () => <CategoryDetailFixture mode="populated" />,
};

export const Loading: Story = {
  beforeEach: () => installDetailBridge("loading"),
  render: () => <CategoryDetailFixture mode="loading" />,
};

export const EmptyLive: Story = {
  beforeEach: () => installDetailBridge("empty"),
  render: () => <CategoryDetailFixture mode="empty" />,
};

export const TwitchUnavailable: Story = {
  beforeEach: () => installDetailBridge("unavailable"),
  render: () => <CategoryDetailFixture mode="unavailable" />,
};
