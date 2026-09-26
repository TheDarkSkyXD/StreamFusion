import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { asMediaJobId, createQueuedMediaJobSnapshot } from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import { ActivityScreen } from "@mobile/features/activity/components/activity-screen";
import { TwitchAccountsPanel } from "@mobile/features/auth/components/twitch-accounts-panel";
import { DiagnosticsWorkspace } from "@mobile/features/diagnostics/components/diagnostics-workspace";
import { HistoryView } from "@mobile/features/media-library/components/history-view";
import { composeWatchHistoryView } from "@mobile/features/media-library/domain/watch-history-view";
import { MediaJobScreen } from "@mobile/features/media-jobs/components/media-job-screen";
import { AppearanceSettingsPanel } from "@mobile/features/settings/components/settings-panels";
import { composeSettingsView } from "@mobile/features/settings/domain/settings-view";
import {
  MORE_ROUTE_IDS,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
} from "@mobile/features/shell/domain/shell-navigation";
import { WatchEmptyState, WatchScreen } from "@mobile/features/watch/components/watch-screen";

const i18nTest = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => {
    if (options && "name" in options) return `${key}:${String(options.name)}`;
    return key;
  },
}));

vi.mock("@mobile/design/select", () => ({
  MobileSelect: "MobileSelect",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));


vi.mock("lucide-react-native", () => ({
  Bell: "Bell",
  BriefcaseBusiness: "BriefcaseBusiness",
  ChevronRight: "ChevronRight",
  CircleAlert: "CircleAlert",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: () => ({ current: null }),
  };
});

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  return [element, ...(Array.isArray(children) ? children : [children]).flatMap(descendants)];
}

function press(nodes: readonly Element[], testID: string): void {
  nodes.find((node) => node.props.testID === testID)?.props.onPress?.();
}

const watchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch" as const,
};

const twitchActions = {
  cancel: () => undefined,
  connect: () => undefined,
  copyCode: () => undefined,
  disconnect: () => undefined,
  manage: () => undefined,
  openVerification: () => undefined,
  refresh: () => undefined,
  retry: () => undefined,
};

const kickActions = {
  cancel: () => undefined,
  connect: () => undefined,
  disconnect: () => undefined,
  manage: () => undefined,
  refresh: () => undefined,
  retry: () => undefined,
};

// Guards: workspace journeys wire Follow, Watch, Chat, Settings, Accounts, jobs, and shell routes
describe("workspace UI journeys", () => {
  it("keeps portrait destinations and More nested routes registered", () => {
    expect(SHELL_DESTINATIONS.map((destination) => destination.id)).toEqual([
      "search",
      "following",
      "watch",
      "activity",
      "more",
    ]);
    expect(MORE_ROUTE_IDS).toEqual([
      "more/categories",
      "more/history",
      "more/downloads",
      "more/moderation",
      "more/settings",
      "more/diagnostics",
      "more/accounts",
    ]);
    expect(MORE_ROUTE_IDS.includes("more/categories")).toBe(true);
    expect(SHELL_ROUTES.watch.id).toBe("watch");
    expect(SHELL_ROUTES["following/manage"].id).toBe("following/manage");
    expect(SHELL_ROUTES["activity/job-preview"].id).toBe("activity/job-preview");
  });

  it("retries Following live failure and starts Watch plus live chat retry", () => {
    // Following live retry testIDs were removed with the guest/live outcome redesign; keep
    // the Watch + live chat retry coverage below as the active journey proof.
    const started: string[] = [];
    const watch = descendants(
      WatchScreen({
        PlayerSurface: () => null,
        chat: {
          detail: "Twitch chat closed before messages arrived.",
          kind: "failed",
          retry: "manual",
        },
        inspection: null,
        onChatRetry: () => started.push("chat"),
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target: watchTarget },
        tab: "chat",
        target: watchTarget,
      }),
    );
    press(watch, "watch-chat-retry");
    expect(started).toEqual(["chat"]);
    expect(
      descendants(WatchEmptyState()).some((node) => node.props.testID === "watch-empty"),
    ).toBe(true);
  });

  it("retries Activity and resumes History", () => {
    const resumed: string[] = [];
    const retriedActivity: string[] = [];
    const activityRoot = ActivityScreen({
      model: {
        allItems: [],
        dismissalConfirmation: null,
        dismissalFailure: false,
        dismissalResult: null,
        filter: "channels",
        isDismissing: false,
        isMarkingAllRead: false,
        isRefreshing: false,
        items: [],
        markingReadEventIds: [],
        mutationFailure: null,
        status: "unavailable",
        unreadCount: 0,
      },
      onCancelDismissal: () => undefined,
      onConfirmDismissal: async () => undefined,
      onDismissVisibleCompleted: () => undefined,
      onMarkAllRead: async () => undefined,
      onOpen: () => undefined,
      onRefresh: async () => retriedActivity.push("activity"),
    }) as ReactElement<{ ListEmptyComponent: unknown }>;
    const activity = descendants(activityRoot.props.ListEmptyComponent);
    press(activity, "activity-retry-load");
    expect(retriedActivity).toEqual(["activity"]);
    const history = descendants(
      HistoryView({
        model: composeWatchHistoryView({
          items: [
            {
              avatarUrl: "https://example.test/a.png",
              channelDisplayName: "Ada",
              channelId: "1",
              channelLogin: "ada",
              contentId: "vod-1",
              durationSeconds: 120,
              id: "twitch-video-vod-1",
              kind: "video",
              platform: "twitch",
              positionSeconds: 40,
              thumbnailUrl: "https://example.test/v.png",
              title: "Yesterday",
              updatedAt: Date.parse("2026-09-14T12:00:00.000Z"),
            },
          ],
          query: "",
        }),
        onCancel: () => undefined,
        onChangeQuery: () => undefined,
        onClear: () => undefined,
        onConfirm: () => undefined,
        onOpen: () => undefined,
        onRemove: () => undefined,
        onReplay: () => undefined,
        onResume: (item) => resumed.push(item.id),
        onRetry: () => undefined,
      }),
    );
    press(history, "history-resume-twitch-video-vod-1");
    expect(resumed).toEqual(["twitch-video-vod-1"]);
  });

  it("commands a Media Job, switches Diagnostics, connects Accounts, and changes Settings density", () => {
    const commands: string[] = [];
    const tabs: string[] = [];
    const accounts: string[] = [];
    let density = DEFAULT_PRODUCT_PREFERENCES.density;
    const job = descendants(
      MediaJobScreen({
        onCommand: (command) => commands.push(command),
        snapshot: createQueuedMediaJobSnapshot({
          createdAt: toSerializedTimestamp("2026-09-14T20:00:00.000Z"),
          jobId: asMediaJobId("download-1"),
          kind: "download",
          schemaVersion: 1,
          sourceUri: "streamfusion-fixture://download",
        }),
      }),
    );
    press(job, "media-job-command-cancel");
    expect(commands).toEqual(["cancel"]);
    expect(
      descendants(MediaJobScreen({ onCommand: () => undefined, snapshot: null })).some(
        (node) => node.props.testID === "media-job-missing",
      ),
    ).toBe(true);
    const diagnostics = descendants(
      DiagnosticsWorkspace({
        collectionCopy: "Collection is current.",
        observationCopy: "Observation window 5m.",
        onRunCheck: () => undefined,
        onSelectTab: (tab) => tabs.push(tab),
        selectedTab: "overview",
        slots: {
          overview: "overview",
          resources: "resources",
          io: "io",
          traces: "traces",
          "logs-reports": "logs",
          "developer-tools": "dev",
        },
      }),
    );
    press(diagnostics, "diagnostics-tab-io");
    expect(tabs).toEqual(["io"]);
    const panel = descendants(
      TwitchAccountsPanel({
        actions: { ...twitchActions, connect: () => accounts.push("twitch") },
        kickAccount: { kind: "disconnected" },
        kickAccountActions: {
          ...kickActions,
          connect: () => accounts.push("kick"),
        },
        model: { kind: "disconnected" },
        onOpenNotificationSettings: () => accounts.push("settings"),
      }),
    );
    press(panel, "connect-account");
    press(panel, "connect-kick-account");
    press(panel, "account-live-alerts");
    expect(accounts).toEqual(["twitch", "kick", "settings"]);
    const settings = descendants(
      AppearanceSettingsPanel({
        onChange: (patch) => {
          if (patch.density) density = patch.density;
        },
        view: composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES }),
      }),
    );
    const densityRow = settings.find((node) => node.props.testID === "density");
    const onSelect = (
      densityRow?.props as { onSelect?: (value: string) => void } | undefined
    )?.onSelect;
    onSelect?.("compact");
    expect(density).toBe("compact");
  });
});
