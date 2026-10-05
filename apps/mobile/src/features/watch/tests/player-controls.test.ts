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
    KeyboardAvoidingView: host("div"),
    Platform: { OS: "android" },
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

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 16, left: 12, right: 12, top: 0 }),
}));

vi.mock("lucide-react-native", async () => {
  const { createElement } = await import("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement("i", {
      "data-icon": name,
      "data-fill": props.fill,
      "data-stroke": props.strokeWidth,
    });
  return {
    Maximize: icon("Maximize"),
    ChevronRight: icon("ChevronRight"),
    Minimize: icon("Minimize"),
    Pause: icon("Pause"),
    Play: icon("Play"),
    RefreshCw: icon("RefreshCw"),
    RotateCcw: icon("RotateCcw"),
    RotateCw: icon("RotateCw"),
    ShieldCheck: icon("ShieldCheck"),
    Volume1: icon("Volume1"),
    Volume2: icon("Volume2"),
    VolumeX: icon("VolumeX"),
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
  onPlayPause: () => undefined,
  onQualityPress: () => undefined,
  onToggleVisible: () => undefined,
  paused: false,
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

  it("keeps the complete live action bar inside the bottom rail", () => {
    const nodes = descendants(
      PlayerControls({ ...base, onRefresh: () => undefined }),
    );
    const rail = findByTestId(nodes, "player-controls-rail");
    expect(rail).toBeTruthy();
    const actions = descendants(rail);
    for (const id of [
      "player-play-pause",
      "player-mute",
      "player-live-badge",
      "player-refresh",
      "player-quality",
      "player-fullscreen",
    ]) {
      expect(findByTestId(actions, id), id).toBeTruthy();
    }
    expect(findByTestId(nodes, "player-seek-back")).toBeUndefined();
    expect(findByTestId(nodes, "player-seek-forward")).toBeUndefined();
  });

  it("flanks VOD play with seek icons and keeps scrub time on the rail", () => {
    const rendered = renderVodControls({
      ...base,
      onSeekBack: () => undefined,
      onSeekForward: () => undefined,
      progress: { durationMs: 90_000, positionMs: 12_000 },
      seekable: true,
    });
    try {
      const rail = findRendered(rendered.container, "player-controls-rail");
      expect(rail).toBeTruthy();
      expect(
        rail?.querySelector('[data-testid="player-seek-back"]'),
      ).toBeTruthy();
      expect(
        rail?.querySelector('[data-testid="player-play-pause"]'),
      ).toBeTruthy();
      expect(
        rail?.querySelector('[data-testid="player-seek-forward"]'),
      ).toBeTruthy();
      expect(
        findRendered(rendered.container, "player-progress")?.textContent,
      ).toContain("0:12 / 1:30");
      expect(findRendered(rendered.container, "player-live-badge")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  it("keeps transport and utilities on the bottom rail", () => {
    const nodes = descendants(PlayerControls(base));
    const rail = findByTestId(nodes, "player-controls-rail");
    expect(rail).toBeTruthy();
    const railDescendants = descendants(rail);
    expect(findByTestId(railDescendants, "player-mute")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-quality")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-pip")).toBeUndefined();
    expect(findByTestId(railDescendants, "player-fullscreen")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-play-pause")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-seek-back")).toBeUndefined();
  });

  it("hides the rail when chrome is not visible but keeps the tap catcher", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        visible: false,
      }),
    );
    expect(findByTestId(nodes, "player-chrome-toggle")).toBeTruthy();
    expect(findByTestId(nodes, "player-controls-rail")).toBeUndefined();
    expect(findByTestId(nodes, "player-play-pause")).toBeUndefined();
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

  it("exposes volume in settings and applies slider changes", () => {
    const changes: number[] = [];
    const nodes = descendants(
      PlayerControls({
        ...base,
        chrome: { showFullscreen: true, showQuality: false, showVolume: true },
        onCloseQualityMenu: () => undefined,
        onVolumeChange: (volume) => changes.push(volume),
        qualityMenuOpen: true,
        muted: true,
        volume: 0.35,
      }),
    );
    const slider = findByTestId(nodes, "player-volume-slider");
    expect(slider?.props.value).toBe(0);
    expect(slider?.props.accessibilityLabel).toBe("Volume");
    expect(slider?.props.style).toMatchObject({ width: "100%", height: 48 });
    expect(findByTestId(nodes, "player-quality-option-720p")).toBeUndefined();
    (
      slider?.props as { onValueChange?: (value: number) => void } | undefined
    )?.onValueChange?.(0.8);
    expect(changes).toEqual([0.8]);
  });

  it("uses mute accessibility labels and opens volume through settings", () => {
    const muted = descendants(PlayerControls({ ...base, muted: true }));
    expect(
      muted.some(
        (node) =>
          node.props.testID === "player-mute" &&
          node.props.accessibilityLabel === "Unmute",
      ),
    ).toBe(true);
    expect(findByTestId(muted, "player-quality")).toBeTruthy();
  });

  it("keeps fullscreen exit available when the entry preference is off", () => {
    const prefs = {
      showFullscreen: false,
      showQuality: true,
      showVolume: true,
    };
    const normal = descendants(PlayerControls({ ...base, chrome: prefs }));
    expect(findByTestId(normal, "player-fullscreen")).toBeUndefined();
    const fullscreen = descendants(
      PlayerControls({ ...base, chrome: prefs, fullscreen: true }),
    );
    expect(
      findByTestId(fullscreen, "player-fullscreen")?.props.accessibilityLabel,
    ).toBe("Exit fullscreen");
    const rail = findByTestId(fullscreen, "player-controls-rail");
    const style = rail?.props.style as
      readonly Record<string, number>[] | undefined;
    expect(style?.[1]).toMatchObject({
      paddingBottom: 16,
      paddingLeft: 12,
      paddingRight: 12,
    });
  });

  it("uses the desktop icon shapes and invokes every live action", () => {
    const actions: string[] = [];
    const rendered = renderVodControls({
      ...base,
      onRefresh: () => actions.push("refresh"),
      onFullscreen: () => actions.push("fullscreen"),
      onMute: () => actions.push("mute"),
      onPlayPause: () => actions.push("play"),
      onQualityPress: () => actions.push("settings"),
    });
    try {
      const rail = findRendered(rendered.container, "player-controls-rail");
      expect(
        rail?.querySelector('[data-icon="Pause"]')?.getAttribute("data-fill"),
      ).toBe("#ffffff");
      expect(
        rail?.querySelector('[data-icon="Volume2"]')?.getAttribute("data-fill"),
      ).toBe("#ffffff");
      expect(
        rail
          ?.querySelector('[data-icon="Maximize"]')
          ?.getAttribute("data-stroke"),
      ).toBe("3");
      const settingsPath = rail?.querySelector(
        '[data-testid="player-quality"] Path',
      );
      expect(
        settingsPath?.getAttribute("d")?.startsWith("M413.967 276.8"),
      ).toBe(true);
      for (const id of [
        "player-play-pause",
        "player-mute",
        "player-refresh",
        "player-quality",
        "player-fullscreen",
      ]) {
        const onPress = pressableProps.get(id)?.onPress;
        if (typeof onPress !== "function")
          throw new Error(`${id} is not pressable`);
        onPress();
      }
      expect(actions).toEqual([
        "play",
        "mute",
        "refresh",
        "settings",
        "fullscreen",
      ]);
    } finally {
      rendered.unmount();
    }
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
