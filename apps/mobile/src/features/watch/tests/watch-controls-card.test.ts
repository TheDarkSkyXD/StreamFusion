// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";

import type { WatchScreenRuntime } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";
import { WatchRoute } from "../components/watch-route";

const routeState = vi.hoisted(
  (): {
    paused: boolean;
    notifications: LiveNotificationPreferences | null;
  } => ({ paused: false, notifications: null }),
);

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => ({
    data:
      options.queryKey[1] === "notifications" ? routeState.notifications : null,
    isFetching: false,
    isError: false,
  }),
  useQueryClient: () => ({
    setQueryData: (
      _key: readonly unknown[],
      value: LiveNotificationPreferences,
    ) => {
      routeState.notifications = value;
    },
  }),
}));
vi.mock(
  "@mobile/features/media-library/components/use-watch-history-capture",
  () => ({ useWatchHistoryCapture: () => undefined }),
);
vi.mock("@mobile/features/chat/components/use-watch-chat", () => ({
  CONNECTING_WATCH_CHAT_SNAPSHOT: { kind: "connecting", detail: "Connecting" },
  useWatchChatConnection: () => undefined,
}));
vi.mock("@mobile/features/discovery/components/use-channel-follow", () => ({
  useChannelFollow: () => ({
    follow: { kind: "guest-absent" },
    toggle: () => undefined,
  }),
}));
vi.mock("../components/use-focused-watch-session", () => ({
  useFocusedWatchSession: () => ({ kind: "active" }),
  useWatchPeek: () => ({
    kind: "active",
    state: {
      phase: routeState.paused ? "paused" : "playing",
      session: { sessionId: "watch:1" },
    },
    presentation: { presentation: "watch", pip: "idle" },
    muted: false,
    quality: "auto",
    qualities: ["auto"],
  }),
}));
vi.mock("../components/watch-screen", async () => {
  const { createElement } = await import("react");
  return {
    WatchEmptyState: () => null,
    WatchScreen: (props: {
      controlsVisible: boolean;
      onToggleControls: () => void;
      onToggleLiveAlerts?: () => void;
      notificationStatus?: string | null;
      liveAlerts: boolean;
      notificationsBusy: boolean;
      tab: string;
    }) =>
      createElement(
        "div",
        {
          "data-testid": "watch-route",
          "data-controls": String(props.controlsVisible),
          "data-tab": props.tab,
          "data-status": props.notificationStatus ?? "",
        },
        createElement("button", {
          "data-testid": "stage-tap",
          onClick: props.onToggleControls,
        }),
        props.onToggleLiveAlerts
          ? createElement("button", {
              "data-testid": "notifications",
              "aria-pressed": props.liveAlerts,
              disabled: props.notificationsBusy,
              onClick: props.onToggleLiveAlerts,
            })
          : null,
      ),
  };
});

const target: WatchTarget = {
  platform: "twitch",
  channelId: "1",
  channelName: "ada",
};
const screen = {
  chat: { retry: () => undefined },
  history: {},
  PlayerSurface: () => null,
  runtime: { session: {} },
} as unknown as WatchScreenRuntime;

describe("watch route control timing", () => {
  it("saves live alerts for Twitch and Kick and shows a failed save", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    routeState.notifications = {
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      sound: false,
      perChannelNotifications: { "kick:other": false },
    };
    const writeNotifications = vi
      .fn<FollowingSession["writeNotifications"]>()
      .mockResolvedValueOnce({
        ...routeState.notifications,
        perChannelNotifications: { "kick:other": false, "twitch:1": false },
      })
      .mockRejectedValueOnce(new Error("Storage unavailable"));
    const following: FollowingSession = {
      listMembership: async () => [],
      listGuestMembership: async () => [],
      removeGuestFollow: async () => ({ kind: "rejected", reason: "invalid" }),
      mutateFollow: async () => ({ kind: "rejected", reason: "invalid" }),
      resolveChannel: async () => null,
      hydrateLive: async () => ({
        twitch: {
          platform: "twitch",
          status: "complete",
          items: [],
          missing: [],
          stale: false,
          offline: false,
          retryable: false,
        },
        kick: {
          platform: "kick",
          status: "complete",
          items: [],
          missing: [],
          stale: false,
          offline: false,
          retryable: false,
        },
      }),
      hydrateRecorded: async ({ platform, channelId }) => ({
        platform,
        channelId,
        supported: true,
        items: [],
        stale: false,
        offline: false,
        failed: false,
      }),
      readNotifications: async () => DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      writeNotifications,
      openProviderPage: async () => undefined,
    };
    try {
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            following,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(
        host.querySelector('[data-testid="notifications"]'),
      ).not.toBeNull();
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="notifications"]')
          ?.click();
      });
      expect(writeNotifications).toHaveBeenCalledWith({
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        sound: false,
        perChannelNotifications: { "kick:other": false, "twitch:1": false },
      });
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            following,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(
        host
          .querySelector('[data-testid="notifications"]')
          ?.getAttribute("aria-pressed"),
      ).toBe("false");
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="notifications"]')
          ?.click();
      });
      expect(
        host
          .querySelector('[data-testid="watch-route"]')
          ?.getAttribute("data-status"),
      ).toBe("Could not save live alerts. Try again.");
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            following,
            target: { ...target, platform: "kick" },
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(
        host.querySelector('[data-testid="notifications"]'),
      ).not.toBeNull();
      expect(
        host
          .querySelector('[data-testid="watch-route"]')
          ?.getAttribute("data-status"),
      ).toBe("");
      writeNotifications.mockResolvedValueOnce({
        ...routeState.notifications,
        perChannelNotifications: {
          "kick:other": false,
          "twitch:1": false,
          "kick:1": false,
        },
      });
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="notifications"]')
          ?.click();
      });
      expect(writeNotifications).toHaveBeenLastCalledWith({
        ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
        sound: false,
        perChannelNotifications: {
          "kick:other": false,
          "twitch:1": false,
          "kick:1": false,
        },
      });
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      routeState.notifications = null;
    }
  });

  it("expands with controls, expires after three seconds, and restarts from each reveal", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const host = document.createElement("div");
    const root = createRoot(host);
    const controls = () =>
      host
        .querySelector('[data-testid="watch-route"]')
        ?.getAttribute("data-controls");
    const tap = async () =>
      act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="stage-tap"]')
          ?.click();
      });
    try {
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(controls()).toBe("true");
      expect(
        host
          .querySelector('[data-testid="watch-route"]')
          ?.getAttribute("data-tab"),
      ).toBe("chat");
      await act(async () => vi.advanceTimersByTime(2_999));
      expect(controls()).toBe("true");
      await act(async () => vi.advanceTimersByTime(1));
      expect(controls()).toBe("false");
      await tap();
      expect(controls()).toBe("true");
      await act(async () => vi.advanceTimersByTime(2_500));
      await tap();
      expect(controls()).toBe("false");
      await tap();
      expect(controls()).toBe("true");
      await act(async () => vi.advanceTimersByTime(2_999));
      expect(controls()).toBe("true");
      await act(async () => vi.advanceTimersByTime(1));
      expect(controls()).toBe("false");
      routeState.paused = true;
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(controls()).toBe("true");
      await act(async () => vi.advanceTimersByTime(3_000));
      expect(controls()).toBe("true");
      routeState.paused = false;
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTime(3_000));
      expect(controls()).toBe("false");
    } finally {
      routeState.paused = false;
      await act(async () => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
