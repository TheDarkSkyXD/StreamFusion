import { isValidElement, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

function findByTestId(
  nodes: readonly Element[],
  testID: string,
): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
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



describe("player controls chrome", () => {
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });


  it("centers play/pause for live streams without seek chips", () => {
    const nodes = descendants(PlayerControls(base));
    expect(findByTestId(nodes, "player-center-transport")).toBeTruthy();
    expect(findByTestId(nodes, "player-play-pause")).toBeTruthy();
    expect(findByTestId(nodes, "player-live-badge")).toBeTruthy();
    expect(findByTestId(nodes, "player-seek-back")).toBeUndefined();
    expect(findByTestId(nodes, "player-seek-forward")).toBeUndefined();
    expect(
      nodes.some((node) =>
        String(node.props.children).includes("Theater and stats"),
      ),
    ).toBe(false);
  });

  it("flanks center play with VOD seek icons and keeps scrub time on the rail", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        onSeekBack: () => undefined,
        onSeekForward: () => undefined,
        progress: { durationMs: 90_000, positionMs: 12_000 },
        seekable: true,
      }),
    );
    const center = findByTestId(nodes, "player-center-transport");
    expect(center).toBeTruthy();
    const centerDescendants = descendants(center);
    expect(findByTestId(centerDescendants, "player-seek-back")).toBeTruthy();
    expect(findByTestId(centerDescendants, "player-play-pause")).toBeTruthy();
    expect(findByTestId(centerDescendants, "player-seek-forward")).toBeTruthy();
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "player-progress" &&
          String(node.props.children).includes("0:12 / 1:30"),
      ),
    ).toBe(true);
    expect(findByTestId(nodes, "player-live-badge")).toBeUndefined();
  });

  it("keeps mute/pip/fullscreen on the bottom rail and quality top-right", () => {
    const nodes = descendants(PlayerControls(base));
    const rail = findByTestId(nodes, "player-controls-rail");
    expect(rail).toBeTruthy();
    const railDescendants = descendants(rail);
    expect(findByTestId(railDescendants, "player-mute")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-quality")).toBeUndefined();
    expect(findByTestId(nodes, "player-quality")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-pip")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-fullscreen")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-play-pause")).toBeUndefined();
    expect(findByTestId(railDescendants, "player-seek-back")).toBeUndefined();
  });

  it("hides the rail and center transport when chrome is not visible but keeps the tap catcher", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        visible: false,
      }),
    );
    expect(findByTestId(nodes, "player-chrome-toggle")).toBeTruthy();
    expect(findByTestId(nodes, "player-controls-rail")).toBeUndefined();
    expect(findByTestId(nodes, "player-center-transport")).toBeUndefined();
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
    expect(findByTestId(nodes, "player-quality-menu")).toBeTruthy();
    const option = findByTestId(nodes, "player-quality-option-720p");
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

  it("renders a VOD scrubber on the rail with clock and seek target", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        onSeekBack: () => undefined,
        onSeekForward: () => undefined,
        onSeekTo: () => undefined,
        progress: { durationMs: 90_000, positionMs: 12_000 },
        seekable: true,
      }),
    );
    expect(findByTestId(nodes, "player-scrubber")).toBeTruthy();
    expect(
      nodes.some(
        (node) =>
          node.props.testID === "player-progress" &&
          String(node.props.children).includes("0:12 / 1:30"),
      ),
    ).toBe(true);
    expect(findByTestId(nodes, "player-live-badge")).toBeUndefined();
  });


});
