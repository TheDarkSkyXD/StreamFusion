// @vitest-environment jsdom
import { act, createElement, isValidElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PlayerControls } from "../components/player-controls";

const pressableProps = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host = (tag: string) => (props: Record<string, unknown>) =>
    createElement(tag, { "data-testid": props.testID }, props.children);
  return {
    Modal: host("div"),
    Pressable: (props: Record<string, unknown>) => {
      if (typeof props.testID === "string")
        pressableProps.set(props.testID, props);
      return createElement(
        "button",
        { "data-testid": props.testID },
        props.children,
      );
    },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host("span"),
    ScrollView: host("div"),
    View: host("div"),
  };
});

vi.mock("lucide-react-native", () => {
  const icon = () => null;
  return {
    Maximize: icon,
    Minimize: icon,
    Pause: icon,
    PictureInPicture2: icon,
    Play: icon,
    RotateCcw: icon,
    RotateCw: icon,
    Settings2: icon,
    ShieldCheck: icon,
    Volume2: icon,
    VolumeX: icon,
  };
});

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

function renderVodControls(options: Parameters<typeof PlayerControls>[0]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (props: Parameters<typeof PlayerControls>[0]) => {
    act(() => root.render(createElement(PlayerControls, props)));
  };
  render(options);
  return {
    container,
    render,
    unmount: () => act(() => root.unmount()),
  };
}

function findRendered(container: HTMLElement, testId: string) {
  return container.querySelector(
    `[testid="${testId}"], [data-testid="${testId}"]`,
  );
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
    t: (key: string, options?: Record<string, unknown>) =>
      i18nTest.t(key, options),
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
    const rendered = renderVodControls({
      ...base,
      onSeekBack: () => undefined,
      onSeekForward: () => undefined,
      progress: { durationMs: 90_000, positionMs: 12_000 },
      seekable: true,
    });
    try {
      const center = findRendered(
        rendered.container,
        "player-center-transport",
      );
      expect(center).toBeTruthy();
      expect(
        center?.querySelector('[data-testid="player-seek-back"]'),
      ).toBeTruthy();
      expect(
        center?.querySelector('[data-testid="player-play-pause"]'),
      ).toBeTruthy();
      expect(
        center?.querySelector('[data-testid="player-seek-forward"]'),
      ).toBeTruthy();
      expect(
        findRendered(rendered.container, "player-progress")?.textContent,
      ).toContain("0:12 / 1:30");
      expect(findRendered(rendered.container, "player-live-badge")).toBeNull();
    } finally {
      rendered.unmount();
    }
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
    (option?.props as { onPress?: () => void } | undefined)?.onPress?.();
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
    const seekTargets: number[] = [];
    const options = {
      ...base,
      onSeekBack: () => undefined,
      onSeekForward: () => undefined,
      onSeekTo: (positionMs: number) => seekTargets.push(positionMs),
      progress: { durationMs: 90_000, positionMs: 12_000 },
      seekable: true,
    };
    const rendered = renderVodControls(options);
    try {
      expect(findRendered(rendered.container, "player-scrubber")).toBeTruthy();
      expect(
        findRendered(rendered.container, "player-progress")?.textContent,
      ).toContain("0:12 / 1:30");
      const onLayout = pressableProps.get("player-scrubber")?.onLayout;
      if (typeof onLayout !== "function")
        throw new Error("Scrubber layout handler is missing.");
      onLayout({ nativeEvent: { layout: { width: 300 } } });
      rendered.render({
        ...options,
        progress: { durationMs: 90_000, positionMs: 20_000 },
      });
      const onPress = pressableProps.get("player-scrubber")?.onPress;
      if (typeof onPress !== "function")
        throw new Error("Scrubber press handler is missing.");
      onPress({ nativeEvent: { locationX: 75 } });
      expect(seekTargets).toEqual([22_500]);
      expect(findRendered(rendered.container, "player-live-badge")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  it("shows an adblock shield on the rail when filtering is active", () => {
    const active = descendants(
      PlayerControls({
        ...base,
        adBlockStatus: { isActive: true, isShowingAd: false },
      }),
    );
    const blocking = descendants(
      PlayerControls({
        ...base,
        adBlockStatus: { isActive: true, isShowingAd: true },
      }),
    );
    const shield = findByTestId(active, "player-adblock-shield");
    expect(shield).toBeTruthy();
    expect(shield?.props.accessibilityLabel).toBe("Ad-block active");
    expect(
      findByTestId(blocking, "player-adblock-shield")?.props.accessibilityLabel,
    ).toBe("Blocking ads");
    expect(
      findByTestId(descendants(PlayerControls(base)), "player-adblock-shield"),
    ).toBeUndefined();
  });
});
