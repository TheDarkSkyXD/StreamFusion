import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Maximize2,
  Move,
  Pause,
  PictureInPicture2,
  Play,
  X,
} from "lucide-react-native";

import { impactHaptic } from "@mobile/design/haptics";
import {
  mobileColors,
  mobileRadii,
  mobileShadows,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { FocusedWatchSession, WatchPeek, WatchTarget } from "../capabilities/watch";
import type { PlayerSurfaceProps } from "./watch-screen";
import {
  miniPlayerSnapStyle,
  type MiniPlayerSnapRegion,
} from "../domain/player-presentation";
import { useWatchPeek } from "./use-focused-watch-session";

const SNAP_CYCLE: readonly MiniPlayerSnapRegion[] = [
  "bottom-end",
  "bottom-start",
  "top-start",
  "top-end",
];

const MINI_WIDTH = 240;
const MINI_VIDEO_HEIGHT = Math.round((MINI_WIDTH * 9) / 16);

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
  if (hidden || peek.kind !== "active" || peek.presentation.presentation !== "mini") {
    return null;
  }
  const pipEligible = peek.state.session.pictureInPictureEligible;
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
      {...(pipEligible
        ? {
            onPip: () => {
              void session.requestPictureInPicture();
            },
          }
        : {})}
      onRelocate={(region) => session.relocateMiniPlayer(region)}
      peek={peek}
    />
  );
}

export function MiniPlayer({
  PlayerSurface,
  onDismiss,
  onExpand,
  onPause,
  onPip,
  onRelocate,
  peek,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly onDismiss: () => void;
  readonly onExpand: () => void;
  readonly onPause: () => void;
  readonly onPip?: () => void;
  readonly onRelocate: (region: MiniPlayerSnapRegion) => void;
  readonly peek: Extract<WatchPeek, { kind: "active" }>;
}) {
  const insets = useSafeAreaInsets();
  const paused = peek.state.phase === "paused";
  const nextRegion =
    SNAP_CYCLE[
      (SNAP_CYCLE.indexOf(peek.presentation.snapRegion) + 1) % SNAP_CYCLE.length
    ]!;
  const { t } = useTranslation();
  const sessionId = peek.state.session.sessionId;
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
          accessibilityLabel={t("playback.watch.expandMiniPlayer")}
          accessibilityRole="button"
          onPress={onExpand}
          style={styles.videoExpand}
          testID="mini-player-video-expand"
        />
        <View style={styles.closeSpot}>
          <IconControl
            Icon={X}
            accessibilityLabel={t("playback.close")}
            onPress={onDismiss}
            testID="dismiss-player"
          />
        </View>
        <View style={styles.controls}>
          <IconControl
            Icon={paused ? Play : Pause}
            accessibilityLabel={
              paused ? t("mediaLibrary.resume") : t("playback.pause")
            }
            onPress={onPause}
            testID="mini-player-pause"
          />
          {onPip ? (
            <IconControl
              Icon={PictureInPicture2}
              accessibilityLabel={t("playback.watch.enterPip")}
              onPress={onPip}
              testID="mini-player-pip"
            />
          ) : null}
          <IconControl
            Icon={Move}
            accessibilityLabel={t("playback.watch.moveToRegion", {
              region: nextRegion,
            })}
            onPress={() => onRelocate(nextRegion)}
            testID="mini-player-relocate"
          />
          <IconControl
            Icon={Maximize2}
            accessibilityLabel={t("playback.watch.expandMiniPlayer")}
            onPress={onExpand}
            testID="mini-player-expand"
          />
        </View>
      </View>
    </View>
  );
}

function IconControl({
  Icon,
  accessibilityLabel,
  onPress,
  testID,
}: {
  readonly Icon: typeof Pause;
  readonly accessibilityLabel: string;
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
      style={({ pressed }) => [styles.control, pressed ? styles.controlPressed : null]}
      testID={testID}
    >
      <Icon
        accessibilityElementsHidden
        color={mobileColors.textPrimary}
        size={18}
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
  videoExpand: {
    ...StyleSheet.absoluteFill,
  },
  closeSpot: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.full,
    position: "absolute",
    right: 0,
    top: 0,
  },
  controls: {
    backgroundColor: mobileColors.overlay,
    bottom: 0,
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: mobileSpacing.small,
    position: "absolute",
    right: 0,
  },
  control: {
    alignItems: "center",
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  controlPressed: {
    backgroundColor: mobileColors.playerScrim,
  },
});
