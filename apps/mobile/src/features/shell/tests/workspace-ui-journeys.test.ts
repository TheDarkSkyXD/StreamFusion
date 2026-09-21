import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { asMediaJobId, createQueuedMediaJobSnapshot } from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";
import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import { ActivityScreen } from "@mobile/features/activity/components/activity-screen";
import { TwitchAccountsPanel } from "@mobile/features/auth/components/twitch-accounts-panel";
import { DiagnosticsWorkspace } from "@mobile/features/diagnostics/components/diagnostics-workspace";
import { FollowingTabBody } from "@mobile/features/follows/components/following-tab-body";
import { composeFollowingView } from "@mobile/features/follows/domain/compose-following-view";
import { guestFollow, liveOutcome } from "@mobile/features/follows/domain/following-fixtures";
import { HistoryView } from "@mobile/features/media-library/components/history-view";
import { composeWatchHistoryView } from "@mobile/features/media-library/domain/watch-history-view";
import { MediaJobScreen } from "@mobile/features/media-jobs/components/media-job-screen";
import { MultistreamView } from "@mobile/features/multistream/components/multistream-view";
import { emptyMultistreamLayout } from "@mobile/features/multistream/capabilities/multistream";
import { addMultistreamSlot, slotFromWatchTarget } from "@mobile/features/multistream/domain/multistream-layout";
import { qualifyMultistream } from "@mobile/features/multistream/domain/multistream-admission";
import { composeMultistreamView } from "@mobile/features/multistream/domain/multistream-view";
import { AppearanceSettingsPanel } from "@mobile/features/settings/components/settings-panels";
import { composeSettingsView } from "@mobile/features/settings/domain/settings-view";
import {
  MORE_ROUTE_IDS,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
} from "@mobile/features/shell/domain/shell-navigation";
import { WatchEmptyState, WatchScreen } from "@mobile/features/watch/components/watch-screen";

vi.mock("react-native", () => ({
  FlatList: "FlatList",
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Bell: "Bell",
  BriefcaseBusiness: "BriefcaseBusiness",
  ChevronRight: "ChevronRight",
  CircleAlert: "CircleAlert",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
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
      "more/home",
      "more/categories",
      "more/multistream",
      "more/history",
      "more/downloads",
      "more/moderation",
      "more/settings",
      "more/diagnostics",
      "more/accounts",
    ]);
    expect(SHELL_ROUTES.watch.id).toBe("watch");
    expect(SHELL_ROUTES["following/manage"].id).toBe("following/manage");
    expect(SHELL_ROUTES["activity/job-preview"].id).toBe("activity/job-preview");
  });

  it("retries Following live failure and starts Watch plus live chat retry", () => {
    const retried: string[] = [];
    const following = descendants(
      FollowingTabBody({
        onOpenProvider: () => undefined,
        onRetry: (platform) => retried.push(platform),
        view: composeFollowingView({
          chip: "all",
          loadingLive: false,
          loadingRecorded: false,
          membership: [guestFollow()],
          notifications: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
          query: "",
          tab: "live",
          twitch: liveOutcome("twitch", "failed"),
        }),
      }),
    );
    press(following, "following-retry-twitch");
    expect(retried).toEqual(["twitch"]);
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
        onStart: () => started.push("watch"),
        playback: { kind: "ready", target: watchTarget },
        tab: "chat",
        target: watchTarget,
      }),
    );
    press(watch, "watch-start");
    press(watch, "watch-chat-retry");
    expect(started).toEqual(["watch", "chat"]);
    expect(
      descendants(WatchEmptyState()).some((node) => node.props.testID === "watch-empty"),
    ).toBe(true);
  });

  it("adds a Multistream slot, retries Activity, and resumes History", () => {
    const added: string[] = [];
    const resumed: string[] = [];
    const slot = slotFromWatchTarget(watchTarget);
    const applied = addMultistreamSlot(emptyMultistreamLayout(), slot, 1);
    expect(applied.kind).toBe("applied");
    if (applied.kind !== "applied") return;
    const multi = descendants(
      MultistreamView({
        PlayerSurface: () => null,
        onAdd: () => added.push("add"),
        onAudioOwner: () => undefined,
        onCancel: () => undefined,
        onClear: () => undefined,
        onCloseEdit: () => undefined,
        onConfirm: () => undefined,
        onCoolDevice: () => undefined,
        onEdit: () => undefined,
        onFocus: () => undefined,
        onMode: () => undefined,
        onPip: () => undefined,
        onRemove: () => undefined,
        onReorder: () => undefined,
        onRestore: () => undefined,
        view: composeMultistreamView({
          qualified: qualifyMultistream({
            admission: { limit: 2, reason: "Measured two software decoders." },
            layout: applied.layout,
            stage: 0,
          }),
          windowWidth: 411,
        }),
        windowWidth: 411,
      }),
    );
    press(multi, "multistream-add");
    expect(added).toEqual(["add"]);
    const retriedActivity: string[] = [];
    const activityRoot = ActivityScreen({
      model: {
        allItems: [],
        dismissalConfirmation: null,
        dismissalFailure: false,
        dismissalResult: null,
        filter: "all",
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
      onSelectFilter: () => undefined,
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
    press(settings, "density-compact");
    expect(density).toBe("compact");
  });
});
