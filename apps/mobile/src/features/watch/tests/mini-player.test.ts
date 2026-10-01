// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MiniPlayer } from "../components/mini-player";
import type { WatchPeek, WatchTarget } from "../capabilities/watch";

const pressableProps = vi.hoisted(
  () => new Map<string, Record<string, unknown>>(),
);

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
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
    },
    View: (props: Record<string, unknown>) =>
      createElement("div", { "data-testid": props.testID }, props.children),
  };
});

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

function renderedMiniPlayer() {
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
});
