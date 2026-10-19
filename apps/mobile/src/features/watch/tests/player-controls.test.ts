// @vitest-environment jsdom
import { act, createElement, isValidElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PlayerControls } from "../components/player-controls";

const pressableProps = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);

vi.mock("@mobile/design/bottom-sheet", () => ({
  MobileBottomSheet: ({
    children,
    footer,
    testID,
  }: Parameters<
    typeof import("@mobile/design/bottom-sheet").MobileBottomSheet
  >[0]) =>
    createElement(
      "div",
      { testID: testID ? `${testID}-menu` : undefined },
      children,
      footer,
    ),
}));

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
    createLucideIcon: icon,
    Maximize: icon("Maximize"),
    ChevronDown: icon("ChevronDown"),
    UserRound: icon("UserRound"),
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
  onSettingsPress: () => undefined,
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

  it("shows one centered live transport with visible back, scrim, and stream facts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    const actions: string[] = [];
    const shown = renderVodControls({
      ...base,
      live: true,
      liveMeta: { startedAt: "2026-01-01T00:00:00.000Z", viewerCount: 695 },
      onBack: () => actions.push("back"),
      onSettingsPress: () => actions.push("settings"),
    });
    try {
      expect(findRendered(shown.container, "player-scrim")).toBeTruthy();
      const center = findRendered(shown.container, "player-live-transport");
      expect(
        center?.querySelector('[data-testid="player-play-pause"]'),
      ).toBeTruthy();
      expect(findRendered(shown.container, "watch-back")).toBeTruthy();
      expect(
        findRendered(shown.container, "player-live-viewers")?.textContent,
      ).toContain("695");
      expect(
        findRendered(shown.container, "player-live-uptime")?.textContent,
      ).toContain("1:00:00");
      act(() => vi.advanceTimersByTime(1000));
      expect(
        findRendered(shown.container, "player-live-uptime")?.textContent,
      ).toContain("1:00:01");
      const back = pressableProps.get("watch-back")?.onPress;
      const settings = pressableProps.get("player-settings")?.onPress;
      if (typeof back !== "function" || typeof settings !== "function")
        throw new Error("Top player actions are missing");
      back();
      settings();
      expect(actions).toEqual(["back", "settings"]);
      shown.render({ ...base, live: true, visible: false });
      expect(findRendered(shown.container, "player-scrim")).toBeNull();
      expect(findRendered(shown.container, "player-live-viewers")).toBeNull();
      expect(findRendered(shown.container, "watch-back")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      shown.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps live metadata and mute on the rail with playback centered", () => {
    const nodes = descendants(PlayerControls(base));
    const rail = findByTestId(nodes, "player-controls-rail");
    expect(rail).toBeTruthy();
    const actions = descendants(rail);
    for (const id of [
      "player-mute",
      "player-live-badge",
      "player-fullscreen",
    ]) {
      expect(findByTestId(actions, id), id).toBeTruthy();
    }
    expect(findByTestId(nodes, "player-live-transport")).toBeTruthy();
    expect(findByTestId(nodes, "player-settings")).toBeTruthy();
    expect(findByTestId(nodes, "player-seek-back")).toBeUndefined();
    expect(findByTestId(nodes, "player-seek-forward")).toBeUndefined();
  });

  it("centers VOD transport above the rail and keeps scrub time on the rail", () => {
    const rendered = renderVodControls({
      ...base,
      onSeekBack: () => undefined,
      onSeekForward: () => undefined,
      progress: { durationMs: 90_000, positionMs: 12_000 },
      seekable: true,
    });
    try {
      const rail = findRendered(rendered.container, "player-controls-rail");
      const transport = findRendered(
        rendered.container,
        "player-recorded-transport",
      );
      expect(rail).toBeTruthy();
      expect(transport).toBeTruthy();
      expect(
        transport?.querySelector('[data-testid="player-seek-back"]'),
      ).toBeTruthy();
      expect(
        transport?.querySelector('[data-testid="player-play-pause"]'),
      ).toBeTruthy();
      expect(
        transport?.querySelector('[data-testid="player-seek-forward"]'),
      ).toBeTruthy();
      expect(
        rail?.querySelector('[data-testid="player-play-pause"]'),
      ).toBeNull();
      expect(
        rendered.container.querySelectorAll(
          '[data-testid="player-play-pause"]',
        ),
      ).toHaveLength(1);
      expect(
        findRendered(rendered.container, "player-progress")?.textContent,
      ).toContain("0:12 / 1:30");
      expect(findRendered(rendered.container, "player-live-badge")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });

  it("does not expose seek controls or a scrubber on a seekable live stream", () => {
    const nodes = descendants(
      PlayerControls({
        ...base,
        live: true,
        onSeekBack: () => undefined,
        onSeekForward: () => undefined,
        onSeekTo: () => undefined,
        progress: { durationMs: 90_000, positionMs: 12_000 },
        seekable: true,
      }),
    );
    expect(findByTestId(nodes, "player-live-badge")).toBeTruthy();
    expect(findByTestId(nodes, "player-refresh")).toBeUndefined();
    expect(findByTestId(nodes, "player-play-pause")).toBeTruthy();
    expect(findByTestId(nodes, "player-recorded-transport")).toBeUndefined();
    for (const id of [
      "player-seek-back",
      "player-seek-forward",
      "player-scrubber",
      "player-progress",
    ]) {
      expect(findByTestId(nodes, id), id).toBeUndefined();
    }
  });

  it("keeps a single centered play button for recorded media before it becomes seekable", () => {
    const nodes = descendants(PlayerControls({ ...base, live: false }));
    const transport = findByTestId(nodes, "player-recorded-transport");
    expect(
      findByTestId(descendants(transport), "player-play-pause"),
    ).toBeTruthy();
    expect(findByTestId(nodes, "player-live-badge")).toBeUndefined();
    expect(findByTestId(nodes, "player-seek-back")).toBeUndefined();
    expect(findByTestId(nodes, "player-seek-forward")).toBeUndefined();
  });

  it("preserves configured recorded skip durations and press callbacks", () => {
    const actions: string[] = [];
    const rendered = renderVodControls({
      ...base,
      live: false,
      seekable: true,
      rewindSeconds: 30,
      fastForwardSeconds: 45,
      onSeekBack: () => actions.push("back"),
      onPlayPause: () => actions.push("pause"),
      onSeekForward: () => actions.push("forward"),
    });
    try {
      const transport = findRendered(
        rendered.container,
        "player-recorded-transport",
      );
      expect(transport?.textContent).toContain("30");
      expect(transport?.textContent).toContain("45");
      for (const id of [
        "player-seek-back",
        "player-play-pause",
        "player-seek-forward",
      ]) {
        const onPress = pressableProps.get(id)?.onPress;
        if (typeof onPress !== "function")
          throw new Error(`${id} is not pressable`);
        onPress();
      }
      expect(actions).toEqual(["back", "pause", "forward"]);
    } finally {
      rendered.unmount();
    }
  });

  it("keeps utility controls on the bottom rail", () => {
    const nodes = descendants(PlayerControls(base));
    const rail = findByTestId(nodes, "player-controls-rail");
    expect(rail).toBeTruthy();
    const railDescendants = descendants(rail);
    expect(findByTestId(railDescendants, "player-mute")).toBeTruthy();
    expect(findByTestId(nodes, "player-settings")).toBeTruthy();
    expect(findByTestId(railDescendants, "player-pip")).toBeUndefined();
    expect(findByTestId(railDescendants, "player-fullscreen")).toBeTruthy();
    expect(findByTestId(nodes, "player-live-transport")).toBeTruthy();
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

  it("keeps settings available without a mobile volume slider", () => {
    const nodes = descendants(PlayerControls({ ...base, muted: true }));
    expect(findByTestId(nodes, "player-settings")).toBeTruthy();
    expect(findByTestId(nodes, "player-volume-slider")).toBeUndefined();
    expect(findByTestId(nodes, "player-quality-menu")).toBeUndefined();
    expect(findByTestId(nodes, "player-mute")?.props.accessibilityLabel).toBe(
      "Unmute",
    );
  });
  it("keeps fullscreen exit available when the entry preference is off", () => {
    const prefs = {
      showFullscreen: false,
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

  it("invokes every live action from the new chrome", () => {
    const actions: string[] = [];
    const rendered = renderVodControls({
      ...base,
      onFullscreen: () => actions.push("fullscreen"),
      onMute: () => actions.push("mute"),
      onPlayPause: () => actions.push("play"),
      onRefresh: () => actions.push("refresh"),
      onSettingsPress: () => actions.push("settings"),
    });
    try {
      const rail = findRendered(rendered.container, "player-controls-rail");
      expect(
        findRendered(rendered.container, "player-live-transport")
          ?.querySelector("[data-fill]")
          ?.getAttribute("data-fill"),
      ).toBe("#ffffff");
      expect(
        rail?.querySelector('[data-icon="Volume2"]')?.getAttribute("data-fill"),
      ).toBe("#ffffff");
      expect(
        findRendered(rendered.container, "player-fullscreen")?.querySelector(
          "Svg",
        ),
      ).toBeTruthy();
      expect(
        findRendered(rendered.container, "player-settings")?.querySelector(
          "Path",
        ),
      ).toBeTruthy();
      for (const id of [
        "player-play-pause",
        "player-mute",
        "player-settings",
        "player-fullscreen",
        "player-refresh",
      ]) {
        const onPress = pressableProps.get(id)?.onPress;
        if (typeof onPress !== "function")
          throw new Error(`${id} is not pressable`);
        onPress();
      }
      expect(actions).toEqual([
        "play",
        "mute",
        "settings",
        "fullscreen",
        "refresh",
      ]);
      rendered.render({
        ...base,
        onRefresh: () => actions.push("refresh"),
        visible: false,
      });
      expect(findRendered(rendered.container, "player-refresh")).toBeNull();
      rendered.render({
        ...base,
        live: false,
        onRefresh: () => actions.push("refresh"),
      });
      expect(findRendered(rendered.container, "player-refresh")).toBeNull();
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
