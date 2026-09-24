import { isValidElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchEmptyState, WatchScreen } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Image: "Image",
  Modal: "Modal",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  ArrowLeft: "ArrowLeft",
  Heart: "Heart",
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

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key as string,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));


vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useState: <S,>(initial: S | (() => S)) => {
      const value =
        typeof initial === "function" ? (initial as () => S)() : initial;
      return [value, () => undefined] as const;
    },
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
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });


  it("requires an explicit start and shows connecting guest chat", () => {
    const root = WatchScreen({
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      playback: { kind: "ready", target },
      tab: "chat",
      target,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "watch-start")).toBe(false);
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
        PlayerSurface: () => null,
        chat: {
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages: [{ badges: [], displayName: "Ada", id: "msg-1", text: "hello" }],
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      liveNodes.some((node) => node.props.testID === "watch-chat-message-msg-1"),
    ).toBe(true);
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    failedNodes.find((node) => node.props.testID === "watch-chat-retry")?.props.onPress?.();
    expect(retried).toEqual(["chat"]);
  });

  it("renders icon transport chrome without verbose limitation copy", () => {
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
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onPip: () => undefined,
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
    expect(nodes.some((node) => node.props.testID === "player-play-pause")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-mute")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-quality")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-fullscreen")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-pip")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-live-badge")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-controls-rail")).toBe(
      true,
    );
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Theater and stats"),
      ),
    ).toBe(false);
    expect(
      nodes.some((node) => node.props.testID === "player-pip-status"),
    ).toBe(false);
  });

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
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onPip: () => undefined,
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
    expect(nodes.some((node) => node.props.testID === "watch-player")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-play-pause")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "watch-target")).toBe(
      false,
    );
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onPip: () => undefined,
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

  it("shows a Video download control and hides download on live", () => {
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
        onOpenProviderPage: () => undefined,
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
      liveNodes.some((node) => node.props.testID === "watch-recording-start"),
    ).toBe(true);
    const videoNodes = descendants(
      WatchScreen({
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target: video },
        tab: "info",
        target: video,
      }),
    );
    expect(
      videoNodes.some((node) => node.props.testID === "watch-download-start"),
    ).toBe(true);
    expect(
      videoNodes.some((node) => node.props.testID === "watch-recording-start"),
    ).toBe(false);
  });

  it("shows local caption overlay and live controls", () => {
    const nodes = descendants(
      WatchScreen({
        PlayerSurface: () => null,
        captions: {
          busy: false,
          cueText: "English model 43.11 MiB. No microphone. No upload.",
          eligibility: {
            kind: "eligible",
            label: "Captions",
            sessionId: "cap-twitch-twitch-1",
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
              onStop: () => undefined,
          session: {
            audioLeftDevice: false,
            audioUploadAttempts: 0,
            cueText: "English model 43.11 MiB. No microphone. No upload.",
            microphonePermissionRequested: false,
            pcmBytesProcessed: 640,
            sessionId: "cap-twitch-twitch-1",
            state: "active",
          },
        },
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-caption-overlay")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "watch-captions")).toBe(true);
  });

  it("renders the empty Watch page with display title and empty panel", () => {
    const nodes = descendants(WatchEmptyState());
    const title = nodes.find((node) => node.props.children === "Watch");
    expect(title?.props.style).toMatchObject({ fontSize: 24, fontWeight: "700" });
    expect(nodes.some((node) => node.props.testID === "watch-empty")).toBe(true);
    expect(nodes.some((node) => node.props.children === "Nothing playing")).toBe(
      true,
    );
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
        PlayerSurface: () => null,
        chat: {
          detail: "Guest chat is live. Sending stays locked.",
          kind: "live",
          messages: [{ badges: [], displayName: "Ada", id: "msg-1", text: "hello" }],
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-under-player")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "watch-chat")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-tab-info")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "watch-tab-related")).toBe(
      false,
    );
    expect(nodes.some((node) => node.props.testID === "watch-tab-chat")).toBe(
      false,
    );
  });

  it("opens stream info under the player from a player tap", () => {
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
      PlayerSurface: () => null,
      chat: {
        detail: "Connecting guest chat.",
        kind: "connecting",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onPip: () => undefined,
      onPlayPause: () => undefined,
      onPlayerTap: () => {
        tabs.push("info");
      },
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
    });
    const nodes = descendants(root);
    nodes.find((node) => node.props.testID === "player-chrome-toggle")?.props.onPress?.();
    expect(tabs).toEqual(["info"]);
    const infoNodes = descendants(
      WatchScreen({
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
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
        PlayerSurface: () => null,
        chat: {
          detail: "Connecting guest chat.",
          kind: "connecting",
        },
        inspection: null,
        onOpenChannel: () => {
          opened.push("channel");
        },
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
          playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-open-channel")).toBe(
      true,
    );
    nodes.find((node) => node.props.testID === "watch-open-channel")?.props.onPress?.();
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
        PlayerSurface: () => null,
        chat: {
          detail: "Comments are unavailable offline.",
          kind: "unavailable",
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
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
    expect(nodes.some((node) => node.props.testID === "watch-tab-comments")).toBe(
      false,
    );
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


  it("stacks channel meta above the player with chat flush underneath", () => {
    const nodes = descendants(
      WatchScreen({
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
          messages: [{ badges: [], displayName: "Ada", id: "msg-1", text: "hello" }],
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
        onOpenProviderPage: () => undefined,
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
    expect(player).toBeGreaterThan(meta);
    expect(under).toBeGreaterThan(player);
    expect(chat).toBeGreaterThan(under);
    expect(ids.includes("watch-tools")).toBe(false);
    expect(ids.includes("watch-adblock-status")).toBe(false);
    expect(ids.includes("watch-captions-privacy")).toBe(false);
  });

  it("shows a Twitch-like channel identity card when info is under the player", () => {
    const nodes = descendants(
      WatchScreen({
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-info")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-info-avatar")).toBe(
      true,
    );
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



  it("renders Twitch-like top channel chrome with avatar name and Follow", () => {
    const followed: string[] = [];
    const nodes = descendants(
      WatchScreen({
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "watch-channel-chrome")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "watch-back")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "watch-open-channel")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "watch-follow")).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "watch-target" &&
          String(node.props.children).includes("Ada"),
      ),
    ).toBe(true);
    nodes.find((node) => node.props.testID === "watch-follow")?.props.onPress?.();
    expect(followed).toEqual(["follow"]);
    const ids = nodes
      .map((node) => node.props.testID)
      .filter((id): id is string => typeof id === "string");
    const metaViewers = nodes.find(
      (node) => node.props.testID === "watch-meta-viewers",
    );
    expect(metaViewers).toBeTruthy();
    const metaText = String(metaViewers?.props.children ?? "");
    expect(metaText.includes("50,443")).toBe(true);
    expect(metaText.includes(" · ")).toBe(true);
    expect(/\d+:\d{2}:\d{2}/u.test(metaText)).toBe(true);
    expect(ids.indexOf("watch-channel-chrome")).toBeLessThan(
      ids.indexOf("watch-player-stage"),
    );
    expect(ids.indexOf("watch-player-stage")).toBeLessThan(
      ids.indexOf("watch-under-player"),
    );
  });


});
