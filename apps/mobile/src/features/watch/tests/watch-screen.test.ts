import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchEmptyState, WatchScreen } from "../components/watch-screen";
import {
  streamTagLabels,
  WatchChannelCard,
} from "../components/watch-channel-card";
import { ChatPanel } from "@mobile/features/chat/components/chat-panel";
import type { WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  Modal: "Modal",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "android" },

  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  TextInput: "TextInput",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  FlatList: (props: {
    data: readonly unknown[];
    renderItem: (entry: { item: unknown }) => ReactNode;
  }) =>
    createElement(
      "FlatList",
      props,
      ...props.data.map((item) => props.renderItem({ item })),
    ),
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  ArrowLeft: "ArrowLeft",
  Settings2: "Settings2",
  Captions: "Captions",
  Download: "Download",
  Ellipsis: "Ellipsis",
  Smile: "Smile",
  ChevronRight: "ChevronRight",
  Heart: "Heart",
  Bell: "Bell",
  BellOff: "BellOff",
  Maximize: "Maximize",
  Minimize: "Minimize",
  Pause: "Pause",
  Play: "Play",
  RefreshCw: "RefreshCw",
  RotateCcw: "RotateCcw",
  RotateCw: "RotateCw",
  ShieldCheck: "ShieldCheck",
  Volume1: "Volume1",
  Volume2: "Volume2",
  VolumeX: "VolumeX",
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    memo: <P>(component: (props: P) => ReactNode) => component,
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => ({ current: initial }),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
      getSnapshot(),
    useState: <S>(initial: S | (() => S)) => {
      const value =
        typeof initial === "function" ? (initial as () => S)() : initial;
      return [value, () => undefined] as const;
    },
  };
});

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  accessibilityRole?: string;
  children?: unknown;
  disabled?: boolean;
  hitSlop?: number;
  onPress?: () => void;
  style?: unknown;
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
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

describe("watch screen", () => {
  it("shows all distinct stream tags with a readable language label", () => {
    expect(
      streamTagLabels("en", [
        "English",
        "DropsEnabled",
        "Music",
        "Gaming",
        "Cozy",
        "music",
      ]),
    ).toEqual(["English", "DropsEnabled", "Music", "Gaming", "Cozy"]);
  });

  it("keeps both actions available below the expanded details", () => {
    const card = descendants(
      WatchChannelCard({
        info: null,
        target,
        expanded: true,
        followed: false,
        followBusy: false,
        onFollow: () => undefined,
        onToggleLiveAlerts: () => undefined,
      }),
    );
    const row = card.find((node) => node.props.testID === "watch-card-actions");
    const actions = descendants(row).filter(
      (node) =>
        node.props.testID === "watch-follow" ||
        node.props.testID === "watch-live-alerts",
    );
    expect(actions).toHaveLength(2);
    expect(
      descendants(row).some(
        (node) => node.props.testID === "watch-open-channel",
      ),
    ).toBe(false);
  });
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });

  it("requires an explicit start and shows connecting guest chat", () => {
    const root = WatchScreen({
      toolSheet: { active: null, onChange: () => undefined },
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onOpenRelated: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      playback: { kind: "ready", target },
      tab: "chat",
      target,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "watch-start")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "watch-player")).toBe(
      false,
    );
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Connecting guest chat"),
      ),
    ).toBe(true);
  });

  it("renders live guest chat messages and retries a failed chat pane", () => {
    const retried: string[] = [];
    const liveNodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages: [
            {
              badges: [
                {
                  imageUrl: "https://example.test/mod.png",
                  setId: "moderator",
                  title: "Moderator",
                  version: "1",
                },
              ],
              color: "#FF7F50",
              displayName: "Ada",
              id: "msg-1",
              text: "hello",
              username: "ada",
            },
          ],
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      liveNodes.some(
        (node) => node.props.testID === "watch-chat-message-msg-1",
      ),
    ).toBe(true);
    expect(
      liveNodes.some((node) => node.props.testID === "watch-chat-chrome-msg-1"),
    ).toBe(true);
    expect(
      liveNodes.some(
        (node) => node.props.testID === "watch-chat-badge-msg-1-moderator",
      ),
    ).toBe(true);
    const chrome = liveNodes.find(
      (node) => node.props.testID === "watch-chat-chrome-msg-1",
    );
    expect(chrome?.props.style).toMatchObject({
      alignItems: "center",
      flexDirection: "row",
    });
    const username = liveNodes.find(
      (node) => node.props.testID === "watch-chat-username-msg-1",
    );
    expect(username?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontSize: 16,
          lineHeight: 22,
        }),
        expect.objectContaining({
          includeFontPadding: false,
          transform: [{ translateY: -1 }],
        }),
        expect.objectContaining({ color: "#FF7F50", fontWeight: "500" }),
      ]),
    );
    const row = liveNodes.find(
      (node) => node.props.testID === "watch-chat-message-msg-1",
    );
    expect(row?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alignItems: "center",
          flexDirection: "row",
        }),
      ]),
    );
    expect(
      liveNodes.some(
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("Ada"),
      ) ||
        liveNodes.some(
          (node) =>
            typeof node.props.children === "string" &&
            node.props.children.includes("hello"),
        ),
    ).toBe(true);
    const failedNodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Twitch chat closed before messages arrived.",
          kind: "failed",
          retry: "manual",
        },
        inspection: null,
        onChatRetry: () => {
          retried.push("chat");
        },
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    failedNodes
      .find((node) => node.props.testID === "watch-chat-retry")
      ?.props.onPress?.();
    expect(retried).toEqual(["chat"]);
  });

  it("renders icon transport chrome without verbose limitation copy", () => {
    const selected: string[] = [];
    const tapped: string[] = [];
    const playback = {
      integration: "twitch-gql-usher" as const,
      kind: "active" as const,
      phase: "playing" as const,
      policySequence: 1,
      protection: { kind: "normal" as const },
      session: { pictureInPictureEligible: true, sessionId: "watch:1" },
      target,
    };
    const root = WatchScreen({
      toolSheet: {
        active: null,
        onChange: (next) => selected.push(String(next)),
      },
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenRelated: () => undefined,
      onPlayerTap: () => tapped.push("video"),
      onPlayPause: () => undefined,
      onQualityPress: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onToggleControls: () => undefined,
      onToggleFullscreen: () => undefined,
      peek: {
        adsDetected: false,
        kind: "active",
        muted: false,
        presentation: {
          pip: "unavailable",
          presentation: "watch",
          previous: null,
          snapRegion: "bottom-end",
        },
        quality: "auto",
        qualities: ["auto"],
        progress: { durationMs: 0, positionMs: 0, seekable: false },
        state: playback,
        volume: 1,
      },
      playback,
      tab: "info",
      target,
    });
    const nodes = descendants(root);
    const stage = nodes.find(
      (node) => node.props.testID === "watch-player-stage",
    );
    const stageNodes = descendants(stage);
    expect(
      stageNodes.filter((node) => node.props.testID === "watch-tools"),
    ).toHaveLength(1);
    expect(
      stageNodes.filter((node) => node.props.testID === "player-quality"),
    ).toHaveLength(1);
    expect(
      stageNodes.filter(
        (node) =>
          node.type === "Pressable" &&
          node.props.testID === "player-fullscreen",
      ),
    ).toHaveLength(1);
    expect(
      nodes.some((node) => node.props.testID === "watch-tool-quality"),
    ).toBe(false);
    expect(
      nodes.some((node) => node.props.testID === "watch-tool-fullscreen"),
    ).toBe(false);
    expect(
      stageNodes.find((node) => node.props.testID === "watch-tool-captions")
        ?.props.disabled,
    ).toBe(true);
    expect(
      stageNodes.find((node) => node.props.testID === "watch-tool-media")?.props
        .disabled,
    ).toBe(true);
    stageNodes
      .find((node) => node.props.testID === "watch-tool-more")
      ?.props.onPress?.();
    expect(selected).toEqual(["more"]);
    expect(tapped).toEqual([]);
    expect(
      nodes.some((node) => node.props.testID === "player-play-pause"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-mute")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-quality")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-fullscreen"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-pip")).toBe(
      false,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-live-badge"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "player-controls-rail"),
    ).toBe(true);
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Theater and stats"),
      ),
    ).toBe(false);
    expect(
      nodes.some((node) => node.props.testID === "player-pip-status"),
    ).toBe(false);
  });

  it.each(["live", "video", "clip"] as const)(
    "reserves seeking chrome for %s media",
    (kind) => {
      const currentTarget: WatchTarget =
        kind === "live"
          ? target
          : {
              ...target,
              media: {
                durationSeconds: 90,
                id: "recording-1",
                kind,
                title: "Recording",
              },
            };
      const playback = {
        integration: "twitch-gql-usher" as const,
        kind: "active" as const,
        phase: "playing" as const,
        policySequence: 1,
        protection: { kind: "normal" as const },
        session: { pictureInPictureEligible: true, sessionId: "watch:1" },
        target: currentTarget,
      };
      const nodes = descendants(
        WatchScreen({
          toolSheet: { active: null, onChange: () => undefined },
          PlayerSurface: () => null,
          chat: { detail: "Connecting guest chat.", kind: "connecting" },
          inspection: null,
          onMute: () => undefined,
          onOpenRelated: () => undefined,
          onPlayPause: () => undefined,
          onQualityPress: () => undefined,
          onRefresh: () => undefined,
          onRetry: () => undefined,
          onSeekBack: () => undefined,
          onSeekForward: () => undefined,
          onSeekTo: () => undefined,
          onSelectTab: () => undefined,
          onToggleControls: () => undefined,
          onToggleFullscreen: () => undefined,
          peek: {
            adsDetected: false,
            kind: "active",
            muted: false,
            presentation: {
              pip: "unavailable",
              presentation: "watch",
              previous: null,
              snapRegion: "bottom-end",
            },
            quality: "auto",
            qualities: ["auto"],
            progress: {
              durationMs: 90_000,
              positionMs: 12_000,
              seekable: true,
            },
            state: playback,
            volume: 1,
          },
          playback,
          tab: "info",
          target: currentTarget,
        }),
      );
      const has = (id: string) =>
        nodes.some((node) => node.props.testID === id);
      const recorded = kind !== "live";
      expect(has("player-recorded-transport")).toBe(recorded);
      expect(has("player-seek-back")).toBe(recorded);
      expect(has("player-seek-forward")).toBe(recorded);
      expect(has("player-scrubber")).toBe(recorded);
      expect(has("player-progress")).toBe(recorded);
      expect(has("player-live-badge")).toBe(!recorded);
      expect(has("player-refresh")).toBe(!recorded);
    },
  );

  it.each(["watch", "fullscreen"] as const)(
    "opens each available stage tool in %s without tapping the video",
    (presentation) => {
      const selected: string[] = [];
      const tapped: string[] = [];
      const playback = {
        integration: "twitch-gql-usher" as const,
        kind: "active" as const,
        phase: "playing" as const,
        policySequence: 1,
        protection: { kind: "normal" as const },
        session: { pictureInPictureEligible: true, sessionId: "watch:1" },
        target,
      };
      const nodes = descendants(
        WatchScreen({
          PlayerSurface: () => null,
          captions: {
            busy: false,
            cueText: "",
            eligibility: {
              kind: "eligible",
              label: "Captions",
              sessionId: "watch:1",
            },
            model: null,
            onInstall: () => undefined,
            onRemove: () => undefined,
            onStart: () => undefined,
            onStop: () => undefined,
            session: null,
            status: null,
          },
          chat: { detail: "Connecting guest chat.", kind: "connecting" },
          inspection: null,
          onMute: () => undefined,
          onOpenRelated: () => undefined,
          onPlayerTap: () => tapped.push("video"),
          onPlayPause: () => undefined,
          onQualityPress: () => undefined,
          onRetry: () => undefined,
          onSelectTab: () => undefined,
          onToggleControls: () => undefined,
          onToggleFullscreen: () => undefined,
          peek: {
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
          },
          playback,
          recording: {
            busy: false,
            eligibility: { kind: "hidden" },
            job: null,
            onCommand: () => undefined,
            onDelete: () => undefined,
            onExport: () => undefined,
            onOpenArtifact: () => undefined,
            onStart: () => undefined,
          },
          tab: "info",
          target,
          toolSheet: {
            active: null,
            onChange: (next) => selected.push(String(next)),
          },
        }),
      );
      for (const [testID, sheet] of [
        ["watch-tool-captions", "captions"],
        ["watch-tool-media", "media"],
        ["watch-tool-more", "more"],
      ] as const) {
        const control = nodes.find(
          (node) => node.type === "Pressable" && node.props.testID === testID,
        );
        expect(control?.props.disabled).toBe(false);
        control?.props.onPress?.();
        expect(selected.at(-1)).toBe(sheet);
      }
      expect(tapped).toEqual([]);
    },
  );

  it("hides Watch chrome while Picture-in-Picture owns the surface", () => {
    const playback = {
      integration: "twitch-gql-usher" as const,
      kind: "active" as const,
      phase: "playing" as const,
      policySequence: 1,
      protection: { kind: "normal" as const },
      session: { pictureInPictureEligible: true, sessionId: "watch:1" },
      target,
    };
    const root = WatchScreen({
      toolSheet: { active: "more", onChange: () => undefined },
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenRelated: () => undefined,
      onPlayPause: () => undefined,
      onQualityPress: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onToggleControls: () => undefined,
      onToggleFullscreen: () => undefined,
      peek: {
        adsDetected: false,
        kind: "active",
        muted: false,
        presentation: {
          pip: "active",
          presentation: "pip",
          previous: "watch",
          snapRegion: "bottom-end",
        },
        quality: "auto",
        qualities: ["auto"],
        progress: { durationMs: 0, positionMs: 0, seekable: false },
        state: playback,
        volume: 1,
      },
      playback,
      tab: "info",
      target,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "watch-player")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-play-pause"),
    ).toBe(false);
    expect(nodes.some((node) => node.props.testID === "watch-target")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "watch-tools")).toBe(
      false,
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-tools-sheet-menu"),
    ).toBe(false);
  });

  it("shows only the player and its controls in fullscreen", () => {
    const playback = {
      integration: "twitch-gql-usher" as const,
      kind: "active" as const,
      phase: "playing" as const,
      policySequence: 1,
      protection: { kind: "normal" as const },
      session: { pictureInPictureEligible: true, sessionId: "watch:1" },
      target,
    };
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: { detail: "Connecting guest chat.", kind: "connecting" },
        inspection: null,
        onMute: () => undefined,
        onOpenRelated: () => undefined,
        onPlayPause: () => undefined,
        onQualityPress: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onToggleControls: () => undefined,
        onToggleFullscreen: () => undefined,
        peek: {
          adsDetected: false,
          kind: "active",
          muted: false,
          presentation: {
            pip: "idle",
            presentation: "fullscreen",
            previous: "watch",
            snapRegion: "bottom-end",
          },
          quality: "auto",
          qualities: ["auto"],
          progress: { durationMs: 0, positionMs: 0, seekable: false },
          state: playback,
          volume: 1,
        },
        playback,
        tab: "info",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-player")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-fullscreen"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "watch-channel-chrome"),
    ).toBe(false);
    expect(
      nodes.some((node) => node.props.testID === "watch-under-player"),
    ).toBe(false);
  });

  it("shows an on-player adblock shield instead of an under-player status card", () => {
    const playback = {
      integration: "twitch-gql-usher" as const,
      kind: "active" as const,
      phase: "playing" as const,
      policySequence: 1,
      protection: { kind: "normal" as const },
      session: { pictureInPictureEligible: true, sessionId: "watch:1" },
      target,
    };
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        adblockView: {
          canary: false,
          detail: "Twitch live playlists strip known ad markers in the player.",
          enabled: true,
          kickSupported: false,
          method: "strip",
          policyAllowed: true,
          title: "Twitch ads are filtered",
          twitchSupported: true,
        },
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onMute: () => undefined,
        onOpenRelated: () => undefined,
        onPlayPause: () => undefined,
        onQualityPress: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onToggleControls: () => undefined,
        onToggleFullscreen: () => undefined,
        peek: {
          adsDetected: false,
          kind: "active",
          muted: false,
          presentation: {
            pip: "unavailable",
            presentation: "watch",
            previous: null,
            snapRegion: "bottom-end",
          },
          quality: "auto",
          qualities: ["auto"],
          progress: { durationMs: 0, positionMs: 0, seekable: false },
          state: playback,
          volume: 1,
        },
        playback,
        tab: "chat",
        target,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "player-adblock-shield"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "watch-adblock-status"),
    ).toBe(false);
  });

  it("keeps secondary tools off a player that is not active", () => {
    const video = {
      ...target,
      media: {
        durationSeconds: 90,
        id: "vod-1",
        kind: "video" as const,
        title: "VOD",
      },
    };
    const liveNodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        download: {
          busy: false,
          eligibility: { kind: "hidden" },
          job: null,
          onCommand: () => undefined,
          onDelete: () => undefined,
          onExport: () => undefined,
          onOpenArtifact: () => undefined,
        },
        recording: {
          busy: false,
          eligibility: {
            kind: "eligible",
            jobId: "rec-twitch-twitch-1" as never,
            label: "Record",
          },
          job: null,
          onCommand: () => undefined,
          onDelete: () => undefined,
          onExport: () => undefined,
          onOpenArtifact: () => undefined,
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(
      liveNodes.some((node) => node.props.testID === "watch-download-start"),
    ).toBe(false);
    expect(
      liveNodes.some((node) => node.props.testID === "watch-tool-media"),
    ).toBe(false);
    const videoNodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        download: {
          busy: false,
          eligibility: {
            kind: "eligible",
            jobId: "dl-twitch-video-vod-1" as never,
            label: "Download video",
          },
          job: null,
          onCommand: () => undefined,
          onDelete: () => undefined,
          onExport: () => undefined,
          onOpenArtifact: () => undefined,
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target: video },
        tab: "info",
        target: video,
      }),
    );
    expect(
      videoNodes.some((node) => node.props.testID === "watch-tool-media"),
    ).toBe(false);
    expect(
      videoNodes.some((node) => node.props.testID === "watch-recording-start"),
    ).toBe(false);
  });

  it.each(["watch:1", "previous-watch"])(
    "fences caption overlay and controls to player %s",
    (captionSessionId) => {
      const nodes = descendants(
        WatchScreen({
          toolSheet: { active: null, onChange: () => undefined },
          PlayerSurface: () => null,
          captions: {
            busy: false,
            cueText: "English model 43.11 MiB. No microphone. No upload.",
            eligibility: {
              kind: "eligible",
              label: "Captions",
              sessionId: captionSessionId,
            },
            model: {
              audioUploadAttempts: 0,
              displaySize: "43.11 MiB",
              downloadedBytes: 45_202_074,
              expectedBytes: 45_202_074,
              installed: true,
              languageLabel: "English",
              license: "Apache-2.0",
              modelId: "english-v1",
              pack: "fixture",
              phase: "ready",
              sha256Verified: true,
              statusMessage:
                "English model ready offline. 43.11 MiB. Audio stays on this device.",
            },
            onInstall: () => undefined,
            onRemove: () => undefined,
            onStart: () => undefined,
            onStop: () => undefined,
            session: {
              audioLeftDevice: false,
              audioUploadAttempts: 0,
              cueText: "English model 43.11 MiB. No microphone. No upload.",
              microphonePermissionRequested: false,
              pcmBytesProcessed: 640,
              sessionId: captionSessionId,
              state: "active",
            },
          },
          chat: {
            detail: "Connecting guest chat.",
            kind: "connecting",
          },
          inspection: null,
          onOpenRelated: () => undefined,
          onRetry: () => undefined,
          onSelectTab: () => undefined,
          playback: {
            kind: "active",
            phase: "playing",
            integration: "twitch-gql-usher",
            policySequence: 1,
            protection: { kind: "normal" },
            session: { pictureInPictureEligible: true, sessionId: "watch:1" },
            target,
          },
          tab: "info",
          target,
        }),
      );
      expect(
        nodes.some((node) => node.props.testID === "watch-caption-overlay"),
      ).toBe(captionSessionId === "watch:1");
      expect(
        nodes.some((node) => node.props.testID === "watch-tool-captions"),
      ).toBe(false);
      expect(
        nodes.some((node) => node.props.testID === "watch-caption-stop"),
      ).toBe(false);
    },
  );

  it("renders the empty Watch panel without repeating the shell title", () => {
    const nodes = descendants(WatchEmptyState());
    const title = nodes.find((node) => node.props.children === "Watch");
    expect(title).toBeUndefined();
    expect(nodes.some((node) => node.props.testID === "watch-empty")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.children === "Nothing playing"),
    ).toBe(true);
    expect(
      nodes.some((node) =>
        String(node.props.children).includes(
          "Pick a live stream or recording from Search or Following",
        ),
      ),
    ).toBe(true);
  });

  it("defaults under-player to chat without Info/Related/Chat chips", () => {
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages: [
            { badges: [], displayName: "Ada", id: "msg-1", text: "hello" },
          ],
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-under-player"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-chat")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-tab-info")).toBe(
      false,
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-tab-related"),
    ).toBe(false);
    expect(nodes.some((node) => node.props.testID === "watch-tab-chat")).toBe(
      false,
    );
  });

  it("toggles player controls while keeping chat under the card", () => {
    const tabs: string[] = [];
    const playback = {
      integration: "twitch-gql-usher" as const,
      kind: "active" as const,
      phase: "playing" as const,
      policySequence: 1,
      protection: { kind: "normal" as const },
      session: { pictureInPictureEligible: true, sessionId: "watch:1" },
      target,
    };
    const root = WatchScreen({
      toolSheet: { active: null, onChange: () => undefined },
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenRelated: () => undefined,
      onPlayPause: () => undefined,
      onQualityPress: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onToggleControls: () => {
        tabs.push("controls");
      },
      onToggleFullscreen: () => undefined,
      peek: {
        adsDetected: false,
        kind: "active",
        muted: false,
        presentation: {
          pip: "unavailable",
          presentation: "watch",
          previous: null,
          snapRegion: "bottom-end",
        },
        quality: "auto",
        qualities: ["auto"],
        progress: { durationMs: 0, positionMs: 0, seekable: false },
        state: playback,
        volume: 1,
      },
      playback,
      tab: "chat",
      target,
    });
    const nodes = descendants(root);
    nodes
      .find((node) => node.props.testID === "player-chrome-toggle")
      ?.props.onPress?.();
    expect(tabs).toEqual(["controls"]);
    expect(
      nodes.some((node) => node.props.testID === "watch-channel-expanded"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-chat")).toBe(true);
    const infoNodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: (tab) => {
          tabs.push(tab);
        },
        playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(infoNodes.some((node) => node.props.testID === "watch-info")).toBe(
      true,
    );
    expect(
      infoNodes.some((node) => node.props.testID === "watch-show-chat"),
    ).toBe(true);
  });

  it("opens the channel surface from the profile row", () => {
    const opened: string[] = [];
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onOpenChannel: () => {
          opened.push("channel");
        },
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-open-channel"),
    ).toBe(true);
    nodes
      .find((node) => node.props.testID === "watch-open-channel")
      ?.props.onPress?.();
    expect(opened).toEqual(["channel"]);
  });

  it("uses comments under the player for recorded media", () => {
    const video = {
      ...target,
      media: {
        durationSeconds: 90,
        id: "vod-1",
        kind: "video" as const,
        title: "VOD",
      },
    };
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Comments are unavailable offline.",
          kind: "unavailable",
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target: video },
        tab: "comments",
        target: video,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-comments")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-tab-comments"),
    ).toBe(false);
  });

  it("wires Watch empty to Home live discovery when a discovery session is provided", () => {
    const source = readFileSync(
      new URL("../components/watch-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("HomeLiveDiscoveryScreen");
    expect(source).toContain('title={t("navigation.watch")}');
    expect(source).toContain("onSelectStream");
    expect(source).not.toContain("WatchRecentList");
    expect(source).not.toContain("continueWatching");
    expect(source).toContain("watch-empty-open-search");
    const route = readFileSync(
      new URL("../components/watch-route.tsx", import.meta.url),
      "utf8",
    );
    expect(route).toContain("onSelectStream: onOpenRelated");
    expect(route).toContain("discovery.session");
  });

  it("renders readable chat usernames beside badges and native emotes", () => {
    const nodes = descendants(
      ChatPanel({
        platform: "twitch",
        chat: {
          kind: "live",
          detail: "Live",
          messages: [
            {
              id: "styled",
              displayName: "Ada",
              username: "ada",
              text: "Kappa",
              badges: [
                {
                  setId: "moderator",
                  version: "1",
                  imageUrl: "https://badges/mod",
                  title: "Moderator",
                },
              ],
              parts: [
                {
                  kind: "emote",
                  text: "Kappa",
                  imageUrl: "https://emotes/kappa",
                },
              ],
            },
          ],
        },
      }),
    );
    expect(
      nodes.find((node) => node.props.testID === "watch-chat-chrome-styled")
        ?.props,
    ).toMatchObject({
      style: { alignItems: "center", flexDirection: "row" },
    });
    expect(
      nodes.find(
        (node) => node.props.testID === "watch-chat-badge-styled-moderator",
      )?.props,
    ).toMatchObject({
      accessibilityLabel: "Moderator",
      source: { uri: "https://badges/mod" },
      style: { width: 18, height: 18 },
    });
    expect(
      nodes.find((node) => node.props.testID === "watch-chat-username-styled")
        ?.props.children,
    ).toBe("Ada");
    expect(
      nodes.some(
        (node) =>
          (node.props as Record<string, unknown>).accessibilityLabel ===
          "Kappa",
      ),
    ).toBe(true);
  });

  it("stacks the mounted player before channel metadata and chat", () => {
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        adblockView: {
          canary: false,
          detail: "Twitch live playlists strip known ad markers in the player.",
          enabled: true,
          kickSupported: false,
          method: "strip",
          policyAllowed: true,
          title: "Twitch ads are filtered",
          twitchSupported: true,
        },
        captions: {
          busy: false,
          cueText: "",
          eligibility: {
            kind: "eligible",
            label: "Captions",
            sessionId: "cap-1",
          },
          model: null,
          onInstall: () => undefined,
          onRemove: () => undefined,
          onStart: () => undefined,
          onStop: () => undefined,
          session: null,
        },
        chat: {
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages: [
            { badges: [], displayName: "Ada", id: "msg-1", text: "hello" },
          ],
        },
        recording: {
          busy: false,
          eligibility: {
            kind: "eligible",
            jobId: "rec-1" as never,
            label: "Record",
          },
          job: null,
          onCommand: () => undefined,
          onDelete: () => undefined,
          onExport: () => undefined,
          onOpenArtifact: () => undefined,
          onStart: () => undefined,
        },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    const ids = nodes
      .map((node) => node.props.testID)
      .filter((id): id is string => typeof id === "string");
    const meta = ids.indexOf("watch-open-channel");
    const player = ids.indexOf("watch-player-stage");
    const under = ids.indexOf("watch-under-player");
    const chat = ids.indexOf("watch-chat");
    expect(meta).toBeGreaterThanOrEqual(0);
    expect(meta).toBeGreaterThan(player);
    expect(under).toBeGreaterThan(player);
    expect(chat).toBeGreaterThan(under);
    expect(ids.includes("watch-tools")).toBe(false);
    expect(ids.includes("watch-adblock-status")).toBe(false);
    expect(ids.includes("watch-captions-privacy")).toBe(false);
  });

  it("shows a Twitch-like channel identity card when info is under the player", () => {
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: {
          info: {
            channel: {
              avatarUrl: "https://cdn.example/avatar.png",
              displayName: "Ada",
              id: "1",
              isLive: true,
              isPartner: false,
              isVerified: true,
              platform: "twitch",
              username: "ada",
            },
            kind: "live",
            stream: {
              categoryId: "cat",
              categoryName: "Just Chatting",
              channelAvatar: "https://cdn.example/avatar.png",
              channelDisplayName: "Ada",
              channelId: "1",
              channelIsVerified: true,
              channelName: "ada",
              id: "s1",
              isLive: true,
              language: "en",
              platform: "twitch",
              startedAt: "2026-01-01T00:00:00.000Z",
              tags: ["english"],
              thumbnailUrl: "https://cdn.example/thumb.png",
              title: "Building StreamFusion",
              viewerCount: 42,
            },
          },
          related: { kind: "empty" },
          target,
        },
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-info")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "watch-info-avatar"),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "watch-info-display-name" &&
          String(node.props.children).includes("Ada"),
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "watch-info-title" &&
          String(node.props.children).includes("Building StreamFusion"),
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-show-chat")).toBe(
      true,
    );
  });

  it("rings the current live channel while watching its recording", () => {
    const recordedTarget: WatchTarget = {
      ...target,
      media: {
        durationSeconds: 120,
        id: "video-1",
        kind: "video",
        title: "Earlier recording",
      },
    };
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: { detail: "Comments unavailable.", kind: "unavailable" },
        inspection: {
          info: {
            channel: {
              avatarUrl: "https://cdn.example/ada.png",
              displayName: "Ada",
              id: "1",
              isLive: true,
              isPartner: false,
              isVerified: false,
              platform: "twitch",
              username: "ada",
            },
            durationSeconds: 120,
            kind: "recorded",
            mediaKind: "video",
            title: "Earlier recording",
          },
          related: { kind: "empty" },
          target: recordedTarget,
        },
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target: recordedTarget },
        tab: "info",
        target: recordedTarget,
      }),
    );
    const avatars = nodes.filter(
      (node) =>
        node.props.accessibilityLabel === "Ada" &&
        node.props.accessibilityRole === "image",
    );
    expect(
      avatars.map((node) => {
        const style = Array.isArray(node.props.style)
          ? Object.assign({}, ...node.props.style)
          : {};
        return [style.width, style.borderColor];
      }),
    ).toEqual([
      [48, "#9146ff"],
      [64, "#9146ff"],
    ]);
    expect(
      nodes.some((node) => node.props.testID === "watch-info-avatar"),
    ).toBe(true);
  });

  it("renders Twitch-like top channel chrome with avatar name and Follow", () => {
    const followed: string[] = [];
    const nodes = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        followed: false,
        inspection: {
          info: {
            channel: {
              avatarUrl: "https://cdn.example/avatar.png",
              displayName: "Ada",
              id: "1",
              isLive: true,
              isPartner: false,
              isVerified: true,
              platform: "twitch",
              username: "ada",
            },
            kind: "live",
            stream: {
              categoryId: "cat",
              categoryName: "Just Chatting",
              channelAvatar: "https://cdn.example/avatar.png",
              channelDisplayName: "Ada",
              channelId: "1",
              channelIsVerified: true,
              channelName: "ada",
              id: "s1",
              isLive: true,
              language: "en",
              platform: "twitch",
              startedAt: "2026-01-01T00:00:00.000Z",
              tags: ["english"],
              thumbnailUrl: "https://cdn.example/thumb.png",
              title: "Building StreamFusion",
              viewerCount: 50_443,
            },
          },
          related: { kind: "empty" },
          target,
        },
        onBack: () => undefined,
        onFollow: () => {
          followed.push("follow");
        },
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-channel-chrome"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-back")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "watch-open-channel"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-follow")).toBe(
      true,
    );
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "watch-target" &&
          String(node.props.children).includes("Ada"),
      ),
    ).toBe(true);
    nodes
      .find((node) => node.props.testID === "watch-follow")
      ?.props.onPress?.();
    expect(followed).toEqual(["follow"]);
    const ids = nodes
      .map((node) => node.props.testID)
      .filter((id): id is string => typeof id === "string");
    expect(
      nodes.some((node) => node.props.testID === "watch-channel-expanded"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-info-tags")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-info-category"),
    ).toBe(true);
    expect(ids.indexOf("watch-channel-chrome")).toBeGreaterThan(
      ids.indexOf("watch-player-stage"),
    );
    expect(ids.indexOf("watch-player-stage")).toBeLessThan(
      ids.indexOf("watch-under-player"),
    );
  });

  it("does not offer Open provider page on failed or ended Watch chrome", () => {
    const failed = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: { detail: "Connecting guest chat.", kind: "connecting" },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: {
          failure: {
            detail: "Player unavailable.",
            integration: "twitch-gql-usher",
            kind: "native-unavailable",
            lastSuccessfulStage: "source-resolved",
            platform: "twitch",
            recovery: ["retry", "open-provider"],
          },
          kind: "failed",
          target,
        },
        tab: "chat",
        target,
      }),
    );
    expect(
      failed.some((node) => node.props.testID === "watch-open-provider"),
    ).toBe(false);
    expect(failed.some((node) => node.props.testID === "watch-retry")).toBe(
      true,
    );

    const ended = descendants(
      WatchScreen({
        toolSheet: { active: null, onChange: () => undefined },
        PlayerSurface: () => null,
        chat: { detail: "Connecting guest chat.", kind: "connecting" },
        inspection: null,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ended", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      ended.some((node) => node.props.testID === "watch-open-provider"),
    ).toBe(false);
  });
});
