import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlayerControls } from "../components/player-controls";

vi.mock("react-native", () => ({
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
  accessibilityLabel?: string;
  children?: unknown;
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

const base = {
  fullscreen: false,
  muted: false,
  onFullscreen: () => undefined,
  onMute: () => undefined,
  onPip: () => undefined,
  onPlayPause: () => undefined,
  onQualityPress: () => undefined,
  onToggleVisible: () => undefined,
  paused: false,
  pipAvailable: true,
  pipPhase: "idle" as const,
  quality: "auto",
  qualities: ["auto", "720p"] as const,
  seekable: false,
  visible: true,
};

describe("player controls chrome", () => {
  it("shows a LIVE badge and no seek chips on live streams", () => {
    const nodes = descendants(PlayerControls(base));
    expect(nodes.some((node) => node.props.testID === "player-live-badge")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "player-seek-back")).toBe(
      false,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-seek-forward"),
    ).toBe(false);
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Theater and stats"),
      ),
    ).toBe(false);
  });

  it("shows VOD seek icons and scrub time when seekable", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        onSeekBack: () => undefined,
        onSeekForward: () => undefined,
        progress: { durationMs: 90_000, positionMs: 12_000 },
        seekable: true,
      }),
    );
    expect(nodes.some((node) => node.props.testID === "player-seek-back")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "player-seek-forward"),
    ).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "player-progress" &&
          String(node.props.children).includes("0:12 / 1:30"),
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.props.testID === "player-live-badge")).toBe(
      false,
    );
  });

  it("hides the rail when chrome is not visible but keeps the tap catcher", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        visible: false,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "player-chrome-toggle"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "player-controls-rail"),
    ).toBe(false);
  });

  it("opens a compact quality sheet from the settings icon", () => {
    const selected: string[] = [];
    const nodes = descendants(
      PlayerControls({
        ...base,
        onCloseQualityMenu: () => undefined,
        onSelectQuality: (quality) => {
          selected.push(quality);
        },
        qualityMenuOpen: true,
      }),
    );
    expect(
      nodes.some((node) => node.props.testID === "player-quality-menu"),
    ).toBe(true);
    const option = nodes.find(
      (node) => node.props.testID === "player-quality-option-720p",
    );
    expect(option).toBeTruthy();
    (
      option?.props as { onPress?: () => void } | undefined
    )?.onPress?.();
    expect(selected).toEqual(["720p"]);
  });

  it("uses mute accessibility labels without a volume slider", () => {
    const muted = descendants(PlayerControls({ ...base, muted: true }));
    expect(
      muted.some(
        (node) =>
          node.props.testID === "player-mute" &&
          node.props.accessibilityLabel === "Unmute",
      ),
    ).toBe(true);
    expect(
      muted.some((node) =>
        String(node.props.testID ?? "").includes("volume-slider"),
      ),
    ).toBe(false);
  });
});
