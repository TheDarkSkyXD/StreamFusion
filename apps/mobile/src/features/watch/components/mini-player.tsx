import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AppState,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { Maximize2, Pause, Play, X } from "lucide-react-native";

import { impactHaptic } from "@mobile/design/haptics";
import {
  mobileColors,
  mobileRadii,
  mobileShadows,
  mobileSizing,
} from "@mobile/design/tokens";
import type {
  FocusedWatchSession,
  WatchPeek,
  WatchTarget,
} from "../capabilities/watch";
import type { PlayerSurfaceProps } from "./watch-screen";
import { useWatchPeek } from "./use-focused-watch-session";
import {
  beginMiniPlayerGesture,
  clampMiniPlayerFrame,
  initialMiniPlayerFrame,
  miniPlayerHeight,
  moveMiniPlayerGesture,
  type MiniPlayerBounds,
  type MiniPlayerFrame,
  type MiniPlayerGesture,
  type MiniPlayerTouch,
} from "../domain/mini-player-geometry";

const CONTROLS_IDLE_MS = 3_000;
const TOUCH_SLOP = 6;

function touchesFrom(
  event: GestureResponderEvent,
  origin: { readonly x: number; readonly y: number },
): MiniPlayerTouch[] {
  return event.nativeEvent.touches.map((touch) => ({
    id: touch.identifier,
    x: touch.pageX - origin.x,
    y: touch.pageY - origin.y,
  }));
}

export function WatchMiniPlayerHost({
  PlayerSurface,
  hidden,
  onExpand,
  session,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly hidden: boolean;
  readonly onExpand: (target: WatchTarget) => void;
  readonly session: FocusedWatchSession;
}) {
  const peek = useWatchPeek(session);
  const workspace = useRef<View>(null);
  const [geometry, setGeometry] = useState<{
    readonly bounds: MiniPlayerBounds;
    readonly origin: { readonly x: number; readonly y: number };
  } | null>(null);
  const [settled, setSettled] = useState<{
    readonly sessionId: string;
    readonly frame: MiniPlayerFrame;
  } | null>(null);
  const sessionId =
    peek.kind === "active" ? peek.state.session.sessionId : null;
  const visible =
    !hidden &&
    peek.kind === "active" &&
    peek.presentation.presentation === "mini";
  const frame =
    geometry && sessionId
      ? clampMiniPlayerFrame(
          settled?.sessionId === sessionId
            ? settled.frame
            : initialMiniPlayerFrame(geometry.bounds),
          geometry.bounds,
        )
      : null;
  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        workspace.current?.measureInWindow((x, y) => {
          const bounds = { left: 0, top: 0, right: width, bottom: height };
          setGeometry({ bounds, origin: { x, y } });
        });
      }}
      pointerEvents="box-none"
      ref={workspace}
      style={styles.workspace}
      testID="mini-player-workspace"
    >
      {visible && peek.kind === "active" && geometry && frame ? (
        <MiniPlayer
          key={sessionId}
          PlayerSurface={PlayerSurface}
          bounds={geometry.bounds}
          frame={frame}
          origin={geometry.origin}
          onFrameCommit={(next) =>
            setSettled({ sessionId: peek.state.session.sessionId, frame: next })
          }
          onDismiss={() => {
            void session.dismiss();
          }}
          onExpand={() => onExpand(peek.state.target)}
          onPause={() => {
            void session.setPlaying(peek.state.phase === "paused");
          }}
          peek={peek}
        />
      ) : null}
    </View>
  );
}

export function MiniPlayer({
  PlayerSurface,
  bounds,
  frame,
  origin,
  onFrameCommit,
  onDismiss,
  onExpand,
  onPause,
  peek,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly bounds: MiniPlayerBounds;
  readonly frame: MiniPlayerFrame;
  readonly origin: { readonly x: number; readonly y: number };
  readonly onFrameCommit: (frame: MiniPlayerFrame) => void;
  readonly onDismiss: () => void;
  readonly onExpand: () => void;
  readonly onPause: () => void;
  readonly peek: Extract<WatchPeek, { kind: "active" }>;
}) {
  const paused = peek.state.phase === "paused";
  const { t } = useTranslation();
  const sessionId = peek.state.session.sessionId;
  const phase = peek.state.phase;
  const [hiddenFor, setHiddenFor] = useState<{
    readonly sessionId: string;
    readonly phase: typeof phase;
  } | null>(null);
  const [idleToken, setIdleToken] = useState(0);
  const [draft, setDraft] = useState<MiniPlayerFrame | null>(null);
  const [manipulating, setManipulating] = useState(false);
  const gesture = useRef<MiniPlayerGesture>({ kind: "idle" });
  const latest = useRef({ bounds, frame, origin, onFrameCommit });
  useLayoutEffect(() => {
    latest.current = { bounds, frame, origin, onFrameCommit };
  }, [bounds, frame, origin, onFrameCommit]);
  const draftFrame = useRef<MiniPlayerFrame | null>(null);
  const startTouch = useRef<MiniPlayerTouch | null>(null);
  const suppressPress = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = (commit: boolean) => {
    if (commit && draftFrame.current)
      latest.current.onFrameCommit(draftFrame.current);
    gesture.current = { kind: "idle" };
    draftFrame.current = null;
    startTouch.current = null;
    setDraft(null);
    setManipulating(false);
    setIdleToken((token) => token + 1);
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => {
      suppressPress.current = false;
    }, 0);
  };
  const wantsStart = (event: GestureResponderEvent) => {
    if (event.nativeEvent.touches.length === 1) {
      startTouch.current = touchesFrom(event, latest.current.origin)[0] ?? null;
    }
    return event.nativeEvent.touches.length >= 2;
  };
  const wantsMove = (
    event: GestureResponderEvent,
    state: PanResponderGestureState,
  ) => {
    return (
      event.nativeEvent.touches.length >= 2 ||
      Math.hypot(state.dx, state.dy) > TOUCH_SLOP
    );
  };
  const grant = (event: GestureResponderEvent) => {
    const current = latest.current;
    const touches = touchesFrom(event, current.origin);
    const firstTouch = startTouch.current;
    suppressPress.current = true;
    const initial =
      touches.length === 1 && firstTouch && firstTouch.id === touches[0]?.id
        ? [firstTouch]
        : touches;
    const next = moveMiniPlayerGesture(
      beginMiniPlayerGesture(initial, current.frame),
      touches,
      current.frame,
      current.bounds,
    );
    gesture.current = next.gesture;
    draftFrame.current = next.frame;
    setDraft(next.frame);
    setManipulating(true);
  };
  const move = (event: GestureResponderEvent) => {
    const current = latest.current;
    if (!draftFrame.current) return;
    const next = moveMiniPlayerGesture(
      gesture.current,
      touchesFrom(event, current.origin),
      draftFrame.current,
      current.bounds,
    );
    gesture.current = next.gesture;
    draftFrame.current = next.frame;
    setDraft(next.frame);
  };
  const end = (event: GestureResponderEvent) => {
    const current = latest.current;
    if (!draftFrame.current) return;
    gesture.current = beginMiniPlayerGesture(
      touchesFrom(event, current.origin),
      draftFrame.current,
    );
  };
  const release = () => finish(true);
  const terminate = () => finish(false);
  // PanResponder stores callbacks and invokes them after render.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: wantsStart,
      onStartShouldSetPanResponderCapture: wantsStart,
      onMoveShouldSetPanResponder: wantsMove,
      onMoveShouldSetPanResponderCapture: wantsMove,
      onPanResponderGrant: grant,
      onPanResponderMove: move,
      onPanResponderEnd: end,
      onPanResponderRelease: release,
      onPanResponderTerminate: terminate,
      onPanResponderTerminationRequest: () => false,
    }),
  );
  useEffect(() => {
    return () => {
      if (suppressTimer.current) clearTimeout(suppressTimer.current);
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && gesture.current.kind !== "idle") finish(false);
    });
    return () => subscription.remove();
  }, []);
  const controlsVisible =
    hiddenFor?.sessionId !== sessionId || hiddenFor.phase !== phase;

  useEffect(() => {
    if (manipulating) return;
    const timeout = setTimeout(
      () => setHiddenFor({ sessionId, phase }),
      CONTROLS_IDLE_MS,
    );
    return () => clearTimeout(timeout);
  }, [sessionId, phase, idleToken, manipulating]);

  const revealControls = () => {
    setHiddenFor(null);
    setIdleToken((token) => token + 1);
  };

  return (
    <View
      accessibilityLabel={t("playback.watch.miniPlayerLabel", {
        channel: peek.state.target.channelName,
      })}
      style={[
        styles.shell,
        {
          left: (draft ?? frame).x,
          top: (draft ?? frame).y,
          width: (draft ?? frame).width,
        },
      ]}
      testID="mini-player"
      {...responder.panHandlers}
    >
      <View
        style={[
          styles.videoFrame,
          { height: miniPlayerHeight((draft ?? frame).width) },
        ]}
        testID="mini-player-video"
      >
        <PlayerSurface sessionId={sessionId} testID="mini-player-surface" />
        <Pressable
          accessibilityLabel={t("playback.watch.showControls")}
          accessibilityRole="button"
          onPress={() => {
            if (!suppressPress.current) revealControls();
          }}
          style={styles.videoReveal}
          testID="mini-player-video-reveal"
        />
        {controlsVisible ? (
          <>
            <View style={styles.expandSpot}>
              <IconControl
                Icon={Maximize2}
                accessibilityLabel={t("playback.watch.expandMiniPlayer")}
                onPress={() => {
                  if (!suppressPress.current) onExpand();
                }}
                testID="mini-player-expand"
              />
            </View>
            <View style={styles.closeSpot}>
              <IconControl
                Icon={X}
                accessibilityLabel={t("playback.close")}
                onPress={() => {
                  if (!suppressPress.current) onDismiss();
                }}
                testID="dismiss-player"
              />
            </View>
            <View pointerEvents="box-none" style={styles.centerSpot}>
              <IconControl
                Icon={paused ? Play : Pause}
                accessibilityLabel={
                  paused ? t("mediaLibrary.resume") : t("playback.pause")
                }
                iconSize={32}
                onPress={() => {
                  if (suppressPress.current) return;
                  revealControls();
                  onPause();
                }}
                testID="mini-player-pause"
              />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function IconControl({
  Icon,
  accessibilityLabel,
  iconSize = 24,
  onPress,
  testID,
}: {
  readonly Icon: typeof Pause;
  readonly accessibilityLabel: string;
  readonly iconSize?: number;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => {
        void impactHaptic("light");
        onPress();
      }}
      style={({ pressed }) => [
        styles.control,
        pressed ? styles.controlPressed : null,
      ]}
      testID={testID}
    >
      <Icon
        accessibilityElementsHidden
        color={mobileColors.textPrimary}
        size={iconSize}
        strokeWidth={2}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspace: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
  },
  shell: {
    backgroundColor: mobileColors.background,
    borderRadius: mobileRadii.large,
    boxShadow: mobileShadows.dialog,
    overflow: "hidden",
    position: "absolute",
    zIndex: 20,
  },
  videoFrame: {
    backgroundColor: "#000000",
    aspectRatio: 16 / 9,
    overflow: "hidden",
    width: "100%",
  },
  videoReveal: {
    ...StyleSheet.absoluteFill,
  },
  expandSpot: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  closeSpot: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  centerSpot: {
    alignItems: "center",
    justifyContent: "center",
    ...StyleSheet.absoluteFill,
    position: "absolute",
  },
  control: {
    alignItems: "center",
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  controlPressed: {
    opacity: 0.7,
  },
});
