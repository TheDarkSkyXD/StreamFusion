import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { miniPlayerSnapStyle } from "../domain/player-presentation";
import { useWatchPeek } from "./use-focused-watch-session";

const MINI_WIDTH = 240;
const MINI_VIDEO_HEIGHT = Math.round((MINI_WIDTH * 9) / 16);
const CONTROLS_IDLE_MS = 3_000;

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
  if (
    hidden ||
    peek.kind !== "active" ||
    peek.presentation.presentation !== "mini"
  ) {
    return null;
  }
  return (
    <MiniPlayer
      PlayerSurface={PlayerSurface}
      onDismiss={() => {
        void session.dismiss();
      }}
      onExpand={() => onExpand(peek.state.target)}
      onPause={() => {
        void session.setPlaying(peek.state.phase === "paused");
      }}
      peek={peek}
    />
  );
}

export function MiniPlayer({
  PlayerSurface,
  onDismiss,
  onExpand,
  onPause,
  peek,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly onDismiss: () => void;
  readonly onExpand: () => void;
  readonly onPause: () => void;
  readonly peek: Extract<WatchPeek, { kind: "active" }>;
}) {
  const insets = useSafeAreaInsets();
  const paused = peek.state.phase === "paused";
  const { t } = useTranslation();
  const sessionId = peek.state.session.sessionId;
  const phase = peek.state.phase;
  const [hiddenFor, setHiddenFor] = useState<{
    readonly sessionId: string;
    readonly phase: typeof phase;
  } | null>(null);
  const [idleToken, setIdleToken] = useState(0);
  const controlsVisible =
    hiddenFor?.sessionId !== sessionId || hiddenFor.phase !== phase;

  useEffect(() => {
    const timeout = setTimeout(
      () => setHiddenFor({ sessionId, phase }),
      CONTROLS_IDLE_MS,
    );
    return () => clearTimeout(timeout);
  }, [sessionId, phase, idleToken]);

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
        miniPlayerSnapStyle(peek.presentation.snapRegion, {
          bottom: insets.bottom + 72,
          top: insets.top,
        }),
      ]}
      testID="mini-player"
    >
      <View style={styles.videoFrame} testID="mini-player-video">
        <PlayerSurface sessionId={sessionId} testID="mini-player-surface" />
        <Pressable
          accessibilityLabel={t("playback.watch.showControls")}
          accessibilityRole="button"
          onPress={revealControls}
          style={styles.videoReveal}
          testID="mini-player-video-reveal"
        />
        {controlsVisible ? (
          <>
            <View style={styles.expandSpot}>
              <IconControl
                Icon={Maximize2}
                accessibilityLabel={t("playback.watch.expandMiniPlayer")}
                onPress={onExpand}
                testID="mini-player-expand"
              />
            </View>
            <View style={styles.closeSpot}>
              <IconControl
                Icon={X}
                accessibilityLabel={t("playback.close")}
                onPress={onDismiss}
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
  shell: {
    backgroundColor: mobileColors.background,
    borderRadius: mobileRadii.large,
    boxShadow: mobileShadows.dialog,
    overflow: "hidden",
    position: "absolute",
    width: MINI_WIDTH,
    zIndex: 20,
  },
  videoFrame: {
    backgroundColor: "#000000",
    height: MINI_VIDEO_HEIGHT,
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
