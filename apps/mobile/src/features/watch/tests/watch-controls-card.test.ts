// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { WatchScreenRuntime } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";
import { WatchRoute } from "../components/watch-route";

const routeState = vi.hoisted(() => ({ paused: false }));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
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
      onSubscribe?: () => void;
      subscriptionStatus?: string | null;
      tab: string;
    }) =>
      createElement(
        "div",
        {
          "data-testid": "watch-route",
          "data-controls": String(props.controlsVisible),
          "data-tab": props.tab,
          "data-status": props.subscriptionStatus ?? "",
        },
        createElement("button", {
          "data-testid": "stage-tap",
          onClick: props.onToggleControls,
        }),
        props.onSubscribe
          ? createElement("button", {
              "data-testid": "subscribe",
              onClick: props.onSubscribe,
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
  it("reports a failed Twitch subscription handoff and hides it for Kick", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    const subscriptionScreen: WatchScreenRuntime = {
      ...screen,
      subscriptionPage: {
        open: async () => {
          throw new Error("No browser");
        },
      },
    };
    try {
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen: subscriptionScreen,
            target,
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(host.querySelector('[data-testid="subscribe"]')).not.toBeNull();
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="subscribe"]')
          ?.click();
      });
      expect(
        host
          .querySelector('[data-testid="watch-route"]')
          ?.getAttribute("data-status"),
      ).toBe("Could not open Twitch subscriptions. Try again.");
      await act(async () =>
        root.render(
          createElement(WatchRoute, {
            screen: subscriptionScreen,
            target: { ...target, platform: "kick" },
            onOpenRelated: () => undefined,
          }),
        ),
      );
      expect(host.querySelector('[data-testid="subscribe"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
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
