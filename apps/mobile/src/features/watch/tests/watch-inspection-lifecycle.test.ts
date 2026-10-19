// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { toSerializedTimestamp } from "@streamfusion/core/content";

import { fixtureChannel } from "@mobile/features/discovery/domain/channel-fixture";
import { fixtureStream } from "@mobile/features/discovery/domain/discovery-fixture";
import type { WatchInspection, WatchTarget } from "../capabilities/watch";
import type { WatchScreenRuntime } from "../components/watch-screen";
import { WatchRoute } from "../components/watch-route";

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
    state: { phase: "playing", session: { sessionId: "watch:1" } },
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
    WatchScreen: ({ inspection }: { inspection: WatchInspection | null }) =>
      createElement("div", {
        "data-kind": inspection?.info.kind ?? "loading",
        "data-stream-id":
          inspection?.info.kind === "live" ? inspection.info.stream.id : "",
        "data-started-at":
          inspection?.info.kind === "live"
            ? inspection.info.stream.startedAt ?? ""
            : "",
      }),
  };
});

const target: WatchTarget = {
  platform: "twitch",
  channelId: "twitch-1",
  channelName: "twitch-live",
};
const firstStart = toSerializedTimestamp("2026-10-19T10:00:00.000Z");
const nextStart = toSerializedTimestamp("2026-10-19T11:00:00.000Z");

function liveInspection(
  watchTarget: WatchTarget,
  streamId: string,
  startedAt: ReturnType<typeof toSerializedTimestamp> | null,
): WatchInspection {
  return {
    target: watchTarget,
    related: { kind: "empty" },
    info: {
      kind: "live",
      channel: fixtureChannel(watchTarget.platform, true),
      stream: {
        ...fixtureStream(watchTarget.platform, streamId, 42),
        channelId: watchTarget.channelId,
        channelName: watchTarget.channelName,
        startedAt,
      },
    },
  };
}

function mountedWatch(initialTarget: WatchTarget, initial: WatchInspection) {
  let next = initial;
  const read = vi.fn(async () => next);
  const screen = {
    chat: { retry: () => undefined },
    history: {},
    PlayerSurface: () => null,
    runtime: { session: {}, inspection: { read } },
  } as unknown as WatchScreenRuntime;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const settle = async () =>
    act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(1);
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    });
  const render = async (watchTarget: WatchTarget = initialTarget) => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WatchRoute, {
            screen,
            target: watchTarget,
            onOpenRelated: () => undefined,
          }),
        ),
      );
    });
    await settle();
  };
  return {
    client,
    host,
    read,
    render,
    settle,
    setNext: (inspection: WatchInspection) => {
      next = inspection;
    },
    unmount: async () => {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}

function shown(host: HTMLElement) {
  const view = host.querySelector("[data-kind]");
  return {
    kind: view?.getAttribute("data-kind"),
    streamId: view?.getAttribute("data-stream-id"),
    startedAt: view?.getAttribute("data-started-at"),
  };
}

describe("watch inspection lifecycle", () => {
  it("keeps a known start on a sparse read of the same broadcast, then accepts a new broadcast", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const watch = mountedWatch(target, liveInspection(target, "broadcast-1", firstStart));
    try {
      await watch.render();
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-1",
        startedAt: firstStart,
      });

      watch.setNext(liveInspection(target, "broadcast-1", null));
      await act(async () => {
        await watch.client.invalidateQueries({ queryKey: ["watch-inspection"] });
      });
      await watch.settle();
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-1",
        startedAt: firstStart,
      });

      watch.setNext(liveInspection(target, "broadcast-2", nextStart));
      await act(async () => {
        await watch.client.invalidateQueries({ queryKey: ["watch-inspection"] });
      });
      await watch.settle();
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-2",
        startedAt: nextStart,
      });

      watch.setNext(liveInspection(target, "broadcast-3", null));
      await act(async () => {
        await watch.client.invalidateQueries({ queryKey: ["watch-inspection"] });
      });
      await watch.settle();
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-3",
        startedAt: "",
      });
    } finally {
      await watch.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("does not carry a live start into an ended stream or another channel", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const watch = mountedWatch(target, liveInspection(target, "broadcast-1", firstStart));
    try {
      await watch.render();
      watch.setNext({
        target,
        related: { kind: "empty" },
        info: { kind: "ended", channel: fixtureChannel("twitch", false) },
      });
      await act(async () => {
        await watch.client.invalidateQueries({ queryKey: ["watch-inspection"] });
      });
      await watch.settle();
      expect(shown(watch.host).kind).toBe("ended");

      const other: WatchTarget = {
        platform: "kick",
        channelId: "kick-2",
        channelName: "other",
      };
      watch.setNext(liveInspection(other, "broadcast-1", null));
      await watch.render(other);
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-1",
        startedAt: "",
      });
    } finally {
      await watch.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("retries an unavailable live inspection while mounted", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const unavailable: WatchInspection = {
      target,
      related: { kind: "empty" },
      info: {
        kind: "unavailable",
        failure: { kind: "provider-unavailable", detail: "Try again", retry: "manual" },
      },
    };
    const watch = mountedWatch(target, unavailable);
    try {
      await watch.render();
      expect(shown(watch.host).kind).toBe("unavailable");
      watch.setNext(liveInspection(target, "broadcast-1", firstStart));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(shown(watch.host)).toEqual({
        kind: "live",
        streamId: "broadcast-1",
        startedAt: firstStart,
      });
      expect(watch.read).toHaveBeenCalledTimes(2);
    } finally {
      await watch.unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("does not poll a recorded inspection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const recordedTarget: WatchTarget = {
      ...target,
      media: { kind: "video", id: "vod-1", title: "Archive", durationSeconds: 90 },
    };
    const watch = mountedWatch(recordedTarget, {
      target: recordedTarget,
      related: { kind: "empty" },
      info: {
        kind: "recorded",
        channel: fixtureChannel("twitch", false),
        durationSeconds: 90,
        mediaKind: "video",
        title: "Archive",
      },
    });
    try {
      await watch.render();
      expect(shown(watch.host).kind).toBe("recorded");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(watch.read).toHaveBeenCalledTimes(1);
    } finally {
      await watch.unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
