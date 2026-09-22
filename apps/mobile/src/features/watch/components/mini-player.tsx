import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Move,
  Pause,
  PictureInPicture2,
  Play,
  X,
} from "lucide-react-native";

import { impactHaptic } from "@mobile/design/haptics";
import {
  mobileColors,
  mobileHitSlop,
  mobileRadii,
  mobileShadows,
  mobileSizing,
  mobileSpacing,
  mobileType,
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

const MINI_WIDTH = 200;
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
  const live = peek.state.target.media === undefined;
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
      <Pressable
        accessibilityLabel={t("playback.watch.expandMiniPlayer")}
        accessibilityRole="button"
        onPress={onExpand}
        style={styles.videoPress}
        testID="mini-player-expand"
      >
        <View style={styles.videoFrame} testID="mini-player-video">
          <PlayerSurface
            sessionId={sessionId}
            testID="mini-player-surface"
          />
          <View pointerEvents="none" style={styles.videoScrim} />
          {live ? (
            <View style={styles.liveBadge} testID="mini-player-live">
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>{t("playback.live")}</Text>
            </View>
          ) : null}
          {paused ? (
            <View style={styles.pausedMark} testID="mini-player-paused-mark">
              <Play
                accessibilityElementsHidden
                color={mobileColors.textPrimary}
                fill={mobileColors.textPrimary}
                size={22}
                strokeWidth={2}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            selectable
            style={styles.title}
            testID="mini-player-title"
          >
            {peek.state.target.channelName}
          </Text>
          <Text selectable style={styles.meta}>
            {paused ? t("playback.watch.paused") : t("playback.watch.playing")}
          </Text>
        </View>
      </Pressable>
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
          Icon={X}
          accessibilityLabel={t("playback.close")}
          onPress={onDismiss}
          testID="dismiss-player"
        />
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
      hitSlop={mobileHitSlop}
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
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    boxShadow: mobileShadows.dialog,
    overflow: "hidden",
    position: "absolute",
    width: MINI_WIDTH,
    zIndex: 20,
  },
  videoPress: {
    width: "100%",
  },
  videoFrame: {
    backgroundColor: "#000000",
    height: MINI_VIDEO_HEIGHT,
    overflow: "hidden",
    width: "100%",
  },
  videoScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: "rgba(15,15,15,0.72)",
    borderRadius: mobileRadii.small,
    flexDirection: "row",
    gap: 4,
    left: mobileSpacing.xSmall,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: "absolute",
    top: mobileSpacing.xSmall,
  },
  liveDot: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.full,
    height: 6,
    width: 6,
  },
  liveLabel: {
    color: mobileColors.textPrimary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  pausedMark: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
  },
  metaRow: {
    gap: 2,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall + 2,
  },
  title: {
    ...mobileType.title,
    fontSize: 13,
    lineHeight: 16,
  },
  meta: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
    fontWeight: "600",
  },
  controls: {
    borderTopColor: mobileColors.dividerMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  control: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  controlPressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
});
