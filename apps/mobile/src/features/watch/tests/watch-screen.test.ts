import { isValidElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { WatchEmptyState, WatchScreen } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Image: "Image",
  Modal: "Modal",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  ScrollView: "ScrollView",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  Maximize: "Maximize",
  Minimize: "Minimize",
  Pause: "Pause",
  PictureInPicture2: "PictureInPicture2",
  Play: "Play",
  RotateCcw: "RotateCcw",
  RotateCw: "RotateCw",
  Settings2: "Settings2",
  Volume2: "Volume2",
  VolumeX: "VolumeX",
}));

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
      onStart: () => undefined,
      playback: { kind: "ready", target },
      tab: "chat",
      target,
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "watch-start")).toBe(true);
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
          messages: [{ displayName: "Ada", id: "msg-1", text: "hello" }],
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onStart: () => undefined,
        playback: { kind: "ready", target },
        tab: "chat",
        target,
      }),
    );
    expect(
      liveNodes.some(
        (node) =>
          node.props.testID === "watch-chat-message-msg-1" &&
          String(node.props.children).includes("Ada: hello"),
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
        onStart: () => undefined,
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
      onStart: () => undefined,
      onToggleControls: () => undefined,
      onToggleFullscreen: () => undefined,
      peek: {
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
      onStart: () => undefined,
      onToggleControls: () => undefined,
      onToggleFullscreen: () => undefined,
      peek: {
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

  it("discloses playback filtering on Watch", () => {
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
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onStart: () => undefined,
        playback: { kind: "ready", target },
        tab: "info",
        target,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "watch-adblock-status"),
    ).toBe(true);
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
          onStart: () => undefined,
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
          onStart: () => undefined,
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onStart: () => undefined,
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
          onStart: () => undefined,
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onStart: () => undefined,
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
          onStart: () => undefined,
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
        onStart: () => undefined,
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
          messages: [{ displayName: "Ada", id: "msg-1", text: "hello" }],
        },
        inspection: null,
        onOpenProviderPage: () => undefined,
        onOpenRelated: () => undefined,
        onRetry: () => undefined,
        onSelectTab: () => undefined,
        onStart: () => undefined,
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
      onStart: () => undefined,
      onToggleControls: () => undefined,
      onToggleFullscreen: () => undefined,
      peek: {
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
        onStart: () => undefined,
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
        onStart: () => undefined,
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
        onStart: () => undefined,
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
    expect(source).toContain('title="Watch"');
    expect(source).toContain("onSelectStream");
    expect(source).toContain("WatchRecentList");
    expect(source).toContain("watch-empty-open-search");
    const route = readFileSync(
      new URL("../components/watch-route.tsx", import.meta.url),
      "utf8",
    );
    expect(route).toContain("onSelectStream: onOpenRelated");
    expect(route).toContain("discovery.session");
  });

});
