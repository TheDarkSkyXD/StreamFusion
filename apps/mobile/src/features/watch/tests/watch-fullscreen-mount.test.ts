// @vitest-environment jsdom

import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { WatchScreen, type WatchToolSheet } from "../components/watch-screen";
import type {
  FocusedWatchState,
  WatchPeek,
  WatchTarget,
} from "../capabilities/watch";
import type { WatchChatSession } from "@mobile/features/chat/capabilities/watch-chat";

const textInputs = vi.hoisted(
  () => new Map<string, { onChangeText?: (text: string) => void }>(),
);

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host =
    (tag: string) => (props: { children?: unknown; testID?: string }) =>
      createElement(tag, { "data-testid": props.testID }, props.children);
  return {
    Image: host("div"),
    Modal: host("div"),
    KeyboardAvoidingView: host("div"),
    Platform: { OS: "android" },
    Pressable: host("button"),
    RefreshControl: host("div"),
    ScrollView: host("div"),
    FlatList: host("div"),
    TextInput: (props: {
      testID?: string;
      value?: string;
      onChangeText?: (text: string) => void;
    }) => {
      if (props.testID) textInputs.set(props.testID, props);
      return createElement("input", {
        "data-testid": props.testID,
        value: props.value,
        readOnly: true,
      });
    },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host("span"),
    View: host("div"),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("lucide-react-native", () => ({
  ArrowLeft: "ArrowLeft",
  Captions: "Captions",
  Download: "Download",
  Ellipsis: "Ellipsis",
  Heart: "Heart",
  Smile: "Smile",
  Maximize: "Maximize",
  Minimize: "Minimize",
  Pause: "Pause",
  PictureInPicture2: "PictureInPicture2",
  Play: "Play",
  RotateCcw: "RotateCcw",
  RotateCw: "RotateCw",
  Settings2: "Settings2",
  ShieldCheck: "ShieldCheck",
  Volume2: "Volume2",
  VolumeX: "VolumeX",
}));

vi.mock("../components/player-controls", () => ({
  PlayerControls: (props: { onToggleVisible: () => void; visible: boolean }) =>
    createElement(
      "button",
      { "data-testid": "player-controls", onClick: props.onToggleVisible },
      String(props.visible),
    ),
}));

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

const playback: FocusedWatchState = {
  integration: "twitch-gql-usher",
  kind: "active",
  phase: "playing",
  policySequence: 1,
  protection: { kind: "normal" },
  session: { pictureInPictureEligible: true, sessionId: "watch:1" },
  target,
};

function peek(presentation: "watch" | "fullscreen"): WatchPeek {
  return {
    adsDetected: false,
    kind: "active",
    muted: false,
    presentation: {
      pip: "idle",
      presentation,
      previous: presentation === "fullscreen" ? "watch" : null,
      snapRegion: "bottom-end",
    },
    quality: "auto",
    qualities: ["auto"],
    progress: { durationMs: 0, positionMs: 0, seekable: false },
    state: playback,
    volume: 1,
  };
}

describe("watch fullscreen player mount", () => {
  it("keeps the chat draft, subscription, and player across card expansion and expiry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const host = document.createElement("div");
    const root = createRoot(host);
    let playerMounts = 0;
    let playerUnmounts = 0;
    let chatSubscribes = 0;
    let chatDisconnects = 0;
    const chatSnapshot = {
      kind: "live" as const,
      detail: "Live",
      messages: [],
    };
    const chatSession: WatchChatSession = {
      attach: () => undefined,
      dispose: () => undefined,
      retry: () => undefined,
      snapshot: () => chatSnapshot,
      subscribe: () => {
        chatSubscribes += 1;
        return () => {
          chatDisconnects += 1;
        };
      },
    };
    function PlayerSurface() {
      useEffect(() => {
        playerMounts += 1;
        return () => {
          playerUnmounts += 1;
        };
      }, []);
      return createElement("div", { "data-testid": "player-surface" });
    }
    function WatchHarness() {
      const [visible, setVisible] = useState(true);
      useEffect(() => {
        if (!visible) return;
        const timer = setTimeout(() => setVisible(false), 3_000);
        return () => clearTimeout(timer);
      }, [visible]);
      return createElement(WatchScreen, {
        PlayerSurface,
        chat: chatSnapshot,
        chatSession,
        controlsVisible: visible,
        inspection: null,
        onMute: () => undefined,
        onOpenRelated: () => undefined,
        onPlayPause: () => undefined,
        onQualityPress: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onToggleControls: () => setVisible((current) => !current),
        onToggleFullscreen: () => undefined,
        peek: peek("watch"),
        playback,
        tab: "chat",
        target,
        toolSheet: { active: null, onChange: () => undefined },
      });
    }
    try {
      await act(async () => root.render(createElement(WatchHarness)));
      await act(async () => {
        textInputs.get("chat-draft")?.onChangeText?.("still here");
      });
      const playerNode = host.querySelector('[data-testid="player-surface"]');
      const chatNode = host.querySelector('[data-testid="watch-chat"]');
      expect(
        host.querySelector('[data-testid="chat-draft"]')?.getAttribute("value"),
      ).toBe("still here");
      expect(
        host.querySelector('[data-testid="watch-channel-expanded"]'),
      ).not.toBeNull();
      await act(async () => vi.advanceTimersByTime(2_999));
      expect(
        host.querySelector('[data-testid="watch-channel-expanded"]'),
      ).not.toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(
        host.querySelector('[data-testid="watch-channel-expanded"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="watch-channel-chrome"]'),
      ).not.toBeNull();
      expect(host.querySelector('[data-testid="watch-chat"]')).toBe(chatNode);
      expect(host.querySelector('[data-testid="player-surface"]')).toBe(
        playerNode,
      );
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>('[data-testid="player-controls"]')
          ?.click();
      });
      expect(
        host.querySelector('[data-testid="watch-channel-expanded"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="chat-draft"]')?.getAttribute("value"),
      ).toBe("still here");
      expect(playerMounts).toBe(1);
      expect(playerUnmounts).toBe(0);
      expect(chatSubscribes).toBe(1);
      expect(chatDisconnects).toBe(0);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the same player surface mounted on fullscreen entry and exit", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    let mounts = 0;
    let unmounts = 0;
    function PlayerSurface() {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return createElement("div", { "data-testid": "player-surface" });
    }
    const renderWatch = (
      presentation: "watch" | "fullscreen",
      active: WatchToolSheet = null,
      controlsVisible = true,
    ) =>
      createElement(WatchScreen, {
        toolSheet: { active, onChange: () => undefined },
        controlsVisible,
        PlayerSurface,
        chat: { detail: "Connecting guest chat.", kind: "connecting" },
        inspection: null,
        onOpenRelated: () => undefined,
        onMute: () => undefined,
        onPlayPause: () => undefined,
        onQualityPress: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onToggleControls: () => undefined,
        onToggleFullscreen: () => undefined,
        peek: peek(presentation),
        playback,
        tab: "info",
        target,
      });

    await act(async () => root.render(renderWatch("watch")));
    for (const sheet of ["captions", "media", "more"] as const) {
      await act(async () => root.render(renderWatch("fullscreen", sheet)));
      expect(
        host.querySelector('[data-testid="watch-tools-sheet-menu"]'),
      ).not.toBeNull();
      expect(host.querySelector('[data-testid="watch-tools"]')).not.toBeNull();
    }
    await act(async () => root.render(renderWatch("fullscreen", null, false)));
    expect(host.querySelector('[data-testid="watch-tools"]')).toBeNull();
    await act(async () => root.render(renderWatch("watch")));

    expect(host.querySelector('[data-testid="player-surface"]')).not.toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
