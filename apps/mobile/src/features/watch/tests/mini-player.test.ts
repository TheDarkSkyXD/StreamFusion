// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MiniPlayer, WatchMiniPlayerHost } from "../components/mini-player";
import type {
  FocusedWatchSession,
  WatchPeek,
  WatchTarget,
} from "../capabilities/watch";

const pressableProps = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);
const viewProps = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const gestureHandlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);
const responderCreates = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-native", async () => {
  const { createElement, forwardRef, useImperativeHandle } =
    await import("react");
  return {
    Pressable: (props: Record<string, unknown>) => {
      if (typeof props.testID === "string")
        pressableProps.set(props.testID, props);
      return createElement(
        "button",
        { "data-testid": props.testID },
        props.children,
      );
    },
    StyleSheet: {
      create: (styles: unknown) => styles,
      absoluteFill: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
      absoluteFillObject: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
    },
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    PanResponder: {
      create: (handlers: Record<string, (...args: unknown[]) => unknown>) => {
        responderCreates.count += 1;
        for (const [name, handler] of Object.entries(handlers))
          gestureHandlers.set(name, handler);
        return { panHandlers: handlers };
      },
    },
    View: forwardRef((props: Record<string, unknown>, ref) => {
      if (typeof props.testID === "string") viewProps.set(props.testID, props);
      useImperativeHandle(ref, () => ({
        measureInWindow: (callback: (x: number, y: number) => void) =>
          callback(0, 0),
      }));
      return createElement(
        "div",
        { "data-testid": props.testID },
        props.children,
      );
    }),
  };
});

vi.mock("../components/use-focused-watch-session", () => ({
  useWatchPeek: (session: { peek(): WatchPeek }) => session.peek(),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => {
    function Icon(props: { readonly size: number }) {
      return createElement("span", {
        "data-icon": name,
        "data-size": props.size,
      });
    }
    return Icon;
  };
  return {
    Maximize2: icon("expand"),
    Pause: icon("pause"),
    Play: icon("play"),
    X: icon("close"),
  };
});

vi.mock("@mobile/design/haptics", () => ({ impactHaptic: () => undefined }));

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

const peek: Extract<WatchPeek, { kind: "active" }> = {
  adsDetected: false,
  kind: "active",
  muted: false,
  presentation: {
    pip: "idle",
    presentation: "mini",
    previous: "watch",
    snapRegion: "bottom-end",
  },
  progress: { durationMs: 0, positionMs: 0, seekable: false },
  quality: "auto",
  qualities: ["auto"],
  state: {
    integration: "twitch-gql-usher",
    kind: "active",
    phase: "playing",
    policySequence: 1,
    protection: { kind: "normal" },
    session: { pictureInPictureEligible: true, sessionId: "watch:1" },
    target,
  },
  volume: 1,
};

const i18nTest = vi.hoisted(() => ({
  t: (key: string, _options?: Record<string, unknown>) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      i18nTest.t(key, options),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

function renderedMiniPlayer(
  geometry: {
    readonly frame: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
    };
    readonly onFrameCommit: (frame: unknown) => void;
  } = {
    frame: { x: 100, y: 100, width: 240 },
    onFrameCommit: () => undefined,
  },
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  let surfaceMounts = 0;
  let surfaceUnmounts = 0;
  const Surface = ({ sessionId }: { readonly sessionId: string }) => {
    useEffect(() => {
      surfaceMounts += 1;
      return () => {
        surfaceUnmounts += 1;
      };
    }, []);
    return createElement("span", {
      "data-testid": "native-video",
      "data-session": sessionId,
    });
  };
  const onPause = vi.fn();
  const onExpand = vi.fn();
  const onDismiss = vi.fn();
  const render = (nextPeek: typeof peek = peek) => {
    act(() =>
      root.render(
        createElement(MiniPlayer, {
          PlayerSurface: Surface,
          onDismiss,
          onExpand,
          onPause,
          peek: nextPeek,
          bounds: { left: 0, top: 0, right: 400, bottom: 800 },
          frame: geometry.frame,
          origin: { x: 0, y: 0 },
          onFrameCommit: geometry.onFrameCommit,
        }),
      ),
    );
  };
  render();
  return {
    container,
    onDismiss,
    onExpand,
    onPause,
    render,
    surfaceCounts: () => ({ mounts: surfaceMounts, unmounts: surfaceUnmounts }),
    unmount: () => act(() => root.unmount()),
  };
}

function press(testID: string) {
  const onPress = pressableProps.get(testID)?.onPress;
  if (typeof onPress !== "function")
    throw new Error(`Missing press target ${testID}`);
  act(() => onPress());
}

function controlIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button[data-testid]"))
    .map((element) => element.getAttribute("data-testid"))
    .filter((id) => id !== "mini-player-video-reveal");
}

describe("mini-player controls", () => {
  beforeAll(async () => {
    const { bootstrapMobileI18n, i18n } = await import("@mobile/i18n");
    await bootstrapMobileI18n();
    i18nTest.t = (key: string, options?: Record<string, unknown>) =>
      i18n.t(key, options as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    pressableProps.clear();
    viewProps.clear();
    gestureHandlers.clear();
    responderCreates.count = 0;
  });

  it("shows only expand, close, and a large centered pause control over the video", () => {
    vi.useFakeTimers();
    const player = renderedMiniPlayer();
    try {
      expect(controlIds(player.container)).toEqual([
        "mini-player-expand",
        "dismiss-player",
        "mini-player-pause",
      ]);
      expect(
        player.container.querySelector('[data-testid="native-video"]'),
      ).not.toBeNull();
      expect(pressableProps.get("mini-player-expand")?.accessibilityLabel).toBe(
        "Expand mini-player",
      );
      expect(pressableProps.get("dismiss-player")?.accessibilityLabel).toBe(
        "Close",
      );
      expect(pressableProps.get("mini-player-pause")?.accessibilityLabel).toBe(
        "Pause",
      );
      expect(
        player.container
          .querySelector('[data-icon="expand"]')
          ?.getAttribute("data-size"),
      ).toBe("24");
      expect(
        player.container
          .querySelector('[data-icon="close"]')
          ?.getAttribute("data-size"),
      ).toBe("24");
      expect(
        player.container
          .querySelector('[data-icon="pause"]')
          ?.getAttribute("data-size"),
      ).toBe("32");
      for (const id of controlIds(player.container)) {
        const style = pressableProps.get(id ?? "")?.style;
        if (typeof style !== "function")
          throw new Error(`Missing style for ${id}`);
        const resting = Object.assign({}, ...style({ pressed: false }));
        const pressed = Object.assign({}, ...style({ pressed: true }));
        expect(resting.minWidth).toBeGreaterThanOrEqual(48);
        expect(resting.minHeight).toBeGreaterThanOrEqual(48);
        expect(resting.backgroundColor).toBeUndefined();
        expect(pressed.backgroundColor).toBeUndefined();
      }
      expect(player.container.textContent).toBe("");
      press("mini-player-expand");
      press("dismiss-player");
      expect(player.onExpand).toHaveBeenCalledTimes(1);
      expect(player.onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      player.unmount();
    }
  });

  it("hides controls after three seconds while paused and reveals them on video tap", () => {
    vi.useFakeTimers();
    const player = renderedMiniPlayer();
    try {
      press("mini-player-pause");
      expect(player.onPause).toHaveBeenCalledTimes(1);
      player.render({ ...peek, state: { ...peek.state, phase: "paused" } });
      expect(pressableProps.get("mini-player-pause")?.accessibilityLabel).toBe(
        "Resume",
      );
      expect(
        player.container
          .querySelector('[data-icon="play"]')
          ?.getAttribute("data-size"),
      ).toBe("32");
      act(() => vi.advanceTimersByTime(2_999));
      expect(controlIds(player.container)).toHaveLength(3);
      act(() => vi.advanceTimersByTime(1));
      expect(controlIds(player.container)).toEqual([]);
      expect(
        player.container.querySelector('[data-testid="native-video"]'),
      ).not.toBeNull();
      expect(player.surfaceCounts()).toEqual({ mounts: 1, unmounts: 0 });
      press("mini-player-video-reveal");
      expect(controlIds(player.container)).toHaveLength(3);
      act(() => vi.advanceTimersByTime(2_000));
      press("mini-player-video-reveal");
      act(() => vi.advanceTimersByTime(2_999));
      expect(controlIds(player.container)).toHaveLength(3);
      act(() => vi.advanceTimersByTime(1));
      expect(controlIds(player.container)).toEqual([]);
      expect(player.surfaceCounts()).toEqual({ mounts: 1, unmounts: 0 });
    } finally {
      player.unmount();
    }
  });

  it("starts a fresh timeout when the session changes and clears it on unmount", () => {
    vi.useFakeTimers();
    const player = renderedMiniPlayer();
    act(() => vi.advanceTimersByTime(2_000));
    player.render({
      ...peek,
      state: {
        ...peek.state,
        session: { ...peek.state.session, sessionId: "watch:2" },
      },
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(controlIds(player.container)).toHaveLength(3);
    expect(
      player.container.querySelector('[data-session="watch:2"]'),
    ).not.toBeNull();
    player.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(player.surfaceCounts()).toEqual({ mounts: 1, unmounts: 1 });
  });

  it("captures a drag that starts on a control without pressing it, then commits the frame", () => {
    vi.useFakeTimers();
    const onFrameCommit = vi.fn();
    const player = renderedMiniPlayer({
      frame: { x: 100, y: 100, width: 240 },
      onFrameCommit,
    });
    const touch = (x: number, y: number) => ({
      nativeEvent: { touches: [{ identifier: "1", pageX: x, pageY: y }] },
    });
    try {
      expect(
        gestureHandlers.get("onMoveShouldSetPanResponderCapture")?.(
          touch(120, 120),
          { dx: 3, dy: 3 },
        ),
      ).toBe(false);
      expect(
        gestureHandlers.get("onMoveShouldSetPanResponderCapture")?.(
          touch(120, 120),
          { dx: 10, dy: 0 },
        ),
      ).toBe(true);
      act(() => gestureHandlers.get("onPanResponderGrant")?.(touch(120, 120)));
      expect(controlIds(player.container)).toHaveLength(3);
      act(() => gestureHandlers.get("onPanResponderMove")?.(touch(150, 160)));
      expect(controlIds(player.container)).toHaveLength(3);
      expect(responderCreates.count).toBe(1);
      expect((viewProps.get("mini-player")?.style as unknown[])[1]).toEqual({
        left: 130,
        top: 140,
        width: 240,
      });
      press("dismiss-player");
      expect(player.onDismiss).not.toHaveBeenCalled();
      act(() => gestureHandlers.get("onPanResponderRelease")?.());
      expect(onFrameCommit).toHaveBeenCalledWith({
        x: 130,
        y: 140,
        width: 240,
      });
      act(() => vi.advanceTimersByTime(0));
      press("mini-player-expand");
      expect(player.onExpand).toHaveBeenCalledTimes(1);
    } finally {
      player.unmount();
    }
  });

  it("commits a fast swipe whose only move is the responder grant", () => {
    const onFrameCommit = vi.fn();
    const player = renderedMiniPlayer({
      frame: { x: 100, y: 100, width: 240 },
      onFrameCommit,
    });
    const touch = (x: number, y: number) => ({
      nativeEvent: { touches: [{ identifier: "1", pageX: x, pageY: y }] },
    });
    try {
      gestureHandlers.get("onStartShouldSetPanResponderCapture")?.(
        touch(120, 120),
      );
      act(() => gestureHandlers.get("onPanResponderGrant")?.(touch(170, 160)));
      act(() => gestureHandlers.get("onPanResponderRelease")?.());
      expect(onFrameCommit).toHaveBeenCalledWith({
        x: 150,
        y: 140,
        width: 240,
      });
      expect(player.onPause).not.toHaveBeenCalled();
    } finally {
      player.unmount();
    }
  });

  it("preserves the settled frame through hidden system PiP workspace bounds", () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let hostPeek: WatchPeek = peek;
    const session = {
      peek: () => hostPeek,
      dismiss: async () => undefined,
      setPlaying: async () => undefined,
    } as FocusedWatchSession;
    const container = document.createElement("div");
    const root = createRoot(container);
    const Surface = ({ sessionId }: { readonly sessionId: string }) =>
      createElement("span", { "data-session": sessionId });
    const render = (hidden: boolean) =>
      act(() =>
        root.render(
          createElement(WatchMiniPlayerHost, {
            PlayerSurface: Surface,
            hidden,
            onExpand: () => undefined,
            session,
          }),
        ),
      );
    const layout = (width: number, height: number) =>
      act(() => {
        const onLayout = viewProps.get("mini-player-workspace")?.onLayout;
        if (typeof onLayout !== "function")
          throw new Error("Mini workspace is missing");
        onLayout({ nativeEvent: { layout: { width, height } } });
      });
    const touch = (x: number, y: number) => ({
      nativeEvent: { touches: [{ identifier: "1", pageX: x, pageY: y }] },
    });
    try {
      render(false);
      layout(400, 800);
      act(() => gestureHandlers.get("onPanResponderGrant")?.(touch(350, 700)));
      act(() => gestureHandlers.get("onPanResponderMove")?.(touch(250, 100)));
      act(() => gestureHandlers.get("onPanResponderRelease")?.());
      expect((viewProps.get("mini-player")?.style as unknown[])[1]).toEqual({
        left: 52,
        top: 57,
        width: 240,
      });

      hostPeek = {
        ...peek,
        presentation: {
          ...peek.presentation,
          presentation: "pip",
          pip: "active",
        },
      };
      render(true);
      layout(180, 120);
      layout(400, 800);
      hostPeek = peek;
      render(false);
      expect((viewProps.get("mini-player")?.style as unknown[])[1]).toEqual({
        left: 52,
        top: 57,
        width: 240,
      });
    } finally {
      act(() => root.unmount());
    }
  });
});
