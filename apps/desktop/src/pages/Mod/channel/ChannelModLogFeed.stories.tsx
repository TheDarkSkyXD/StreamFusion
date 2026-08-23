import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { ElectronAPI } from "@/preload";
import type {
  ModLogEntry,
  ModLogQueryFilters,
  ModerationHistoryResult,
} from "@/shared/mod-log-types";

import { ChannelModLogFeed } from "./ChannelModLogFeed";

type ModLogState = "loading" | "empty" | "populated" | "error" | "filtered" | "retry";
type ModLogStoryArgs = ComponentProps<typeof ChannelModLogFeed> & { fixtureState: ModLogState };

const STORY_CHANNEL_ID = "story-twitch-channel";
const STORY_CHANNEL_SLUG = "novaarcade";
const storybookElectronApi = window.electronAPI;

const entries = [
  {
    id: 101,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelSlug: STORY_CHANNEL_SLUG,
    action: "ban",
    targetUserId: "target-orbit",
    targetUsername: "Orbit Owl",
    moderatorUserId: "mod-mira",
    moderatorUsername: "Mira",
    durationSeconds: null,
    reason: "Repeated spoilers after a warning",
    provenance: "twitch-observed",
    providerEventId: "story-event-101",
    occurredAt: Date.UTC(2026, 7, 10, 18, 0),
    observedAt: Date.UTC(2026, 7, 10, 18, 0, 2),
    createdAt: Date.UTC(2026, 7, 10, 18, 0),
  },
  {
    id: 102,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelSlug: STORY_CHANNEL_SLUG,
    action: "timeout",
    targetUserId: "target-lumen",
    targetUsername: "Lumen Lark",
    moderatorUserId: "mod-sage",
    moderatorUsername: "Sage",
    durationSeconds: 600,
    reason: null,
    provenance: "twitch-eventsub",
    providerEventId: "story-event-102",
    occurredAt: Date.UTC(2026, 7, 10, 17, 52),
    observedAt: Date.UTC(2026, 7, 10, 17, 52, 1),
    createdAt: Date.UTC(2026, 7, 10, 17, 52),
  },
] satisfies ModLogEntry[];

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function ready(rows: ModLogEntry[]): ModerationHistoryResult {
  return { state: "ready", entries: rows, coverage: "complete" };
}

function createModLogBridge(state: ModLogState): ElectronAPI["modLog"] {
  let retryCount = 0;

  return {
    ...storybookElectronApi.modLog,
    query: async (filters: ModLogQueryFilters) => {
      if (state === "loading") return neverResolves();
      if (state === "empty") return { state: "verified-empty", entries: [], coverage: "complete" };
      if (state === "error")
        return { state: "error", entries: [], code: "query-failed", retryable: false };
      if (state === "retry") {
        retryCount += 1;
        return retryCount === 1
          ? { state: "error", entries: [], code: "query-failed", retryable: true }
          : ready(entries);
      }
      if (state === "filtered") {
        const hasMiraBan =
          filters.action === "ban" && filters.moderatorUsername?.toLowerCase() === "mira";
        return ready(hasMiraBan ? [entries[0]] : entries);
      }
      return ready(entries);
    },
  };
}

function installModLogBridge(state: ModLogState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  Object.defineProperty(electronApi, "modLog", {
    configurable: true,
    value: createModLogBridge(state),
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronApi });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
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
}

function ModLogQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function StoryCanvas() {
  return (
    <ModLogQueryProvider>
      <div className="min-h-[420px] min-w-[680px] bg-[var(--color-background)] p-6">
        <ChannelModLogFeed
          platform="twitch"
          channelId={STORY_CHANNEL_ID}
          channelSlug={STORY_CHANNEL_SLUG}
        />
      </div>
    </ModLogQueryProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ChannelModLogFeed",
  component: ChannelModLogFeed,
  args: {
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelSlug: STORY_CHANNEL_SLUG,
    fixtureState: "loading",
  },
  beforeEach: ({ args }) => installModLogBridge(args.fixtureState),
  render: () => <StoryCanvas />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Fixed React Query and Electron mod-log fixtures, with no live IPC or platform API calls.",
      },
    },
  },
} satisfies Meta<ModLogStoryArgs>;

export default meta;
type Story = StoryObj<ModLogStoryArgs>;

export const Loading: Story = {
  args: { fixtureState: "loading" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Loading\u2026")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { fixtureState: "empty" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No mod-log entries.")).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("modlog-row")).toBeInTheDocument();
    await expect(canvas.getByText("Orbit Owl")).toBeInTheDocument();
    await expect(canvas.getByText("(10m)")).toBeInTheDocument();
  },
};

export const Error: Story = {
  args: { fixtureState: "error" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Moderation history couldn't be verified.")
    ).toBeInTheDocument();
  },
};

export const FiltersEntries: Story = {
  args: { fixtureState: "filtered" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Lumen Lark");
    await userEvent.selectOptions(canvas.getByLabelText("Filter by action"), "ban");
    await userEvent.type(canvas.getByTestId("modlog-moderator-filter"), "Mira");
    await expect(await canvas.findByText("Orbit Owl")).toBeInTheDocument();
    await expect(canvas.queryByText("Lumen Lark")).not.toBeInTheDocument();
  },
};

export const RetryRecovers: Story = {
  args: { fixtureState: "retry" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Retry" }));
    await expect(await canvas.findByText("Orbit Owl")).toBeInTheDocument();
  },
};
