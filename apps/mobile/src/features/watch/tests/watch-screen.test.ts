import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { WatchScreen } from "../components/watch-screen";
import type { WatchTarget } from "../capabilities/watch";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: "Text",
  View: "View",
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
  it("requires an explicit start and keeps chat disconnected", () => {
    const root = WatchScreen({
      PlayerSurface: () => null,
      chat: {
        detail: "Chat is not connected in this build. Watching continues.",
        kind: "not-connected",
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
        String(node.props.children).includes("Chat is not connected"),
      ),
    ).toBe(true);
  });

  it("renders transport controls and named PiP unavailable copy", () => {
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
        detail: "Chat is not connected in this build. Watching continues.",
        kind: "not-connected",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onPip: () => undefined,
      onPlayPause: () => undefined,
      onQuality: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onStart: () => undefined,
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
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "player-pip-status" &&
          String(node.props.children).includes("unavailable"),
      ),
    ).toBe(true);
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
        detail: "Chat is not connected in this build. Watching continues.",
        kind: "not-connected",
      },
      inspection: null,
      onMute: () => undefined,
      onOpenProviderPage: () => undefined,
      onOpenRelated: () => undefined,
      onPip: () => undefined,
      onPlayPause: () => undefined,
      onQuality: () => undefined,
      onRetry: () => undefined,
      onSelectTab: () => undefined,
      onStart: () => undefined,
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
          detail: "Chat is not connected in this build. Watching continues.",
          kind: "not-connected",
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
          detail: "Chat is not connected in this build. Watching continues.",
          kind: "not-connected",
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
          detail: "Chat is not connected in this build. Watching continues.",
          kind: "not-connected",
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
});
