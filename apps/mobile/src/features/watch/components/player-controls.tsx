import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import type { PictureInPicturePhase } from "../capabilities/watch";
import {
  FULLSCREEN_LIFECYCLE_COPY,
  pictureInPictureStatusCopy,
} from "../domain/player-presentation";

export function PlayerControls({
  chrome,
  fullscreen,
  muted,
  onFullscreen,
  onMute,
  onPip,
  onPlayPause,
  onQuality,
  onSeekBack,
  onSeekForward,
  paused,
  pipAvailable,
  pipPhase,
  progress,
  quality,
  rewindSeconds = 10,
  fastForwardSeconds = 10,
  seekable,
}: {
  readonly chrome?: {
    readonly showFullscreen: boolean;
    readonly showQuality: boolean;
    readonly showVolume: boolean;
  };
  readonly fastForwardSeconds?: number;
  readonly fullscreen: boolean;
  readonly muted: boolean;
  readonly onFullscreen: () => void;
  readonly onMute: () => void;
  readonly onPip: () => void;
  readonly onPlayPause: () => void;
  readonly onQuality: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly paused: boolean;
  readonly pipAvailable: boolean;
  readonly pipPhase: PictureInPicturePhase;
  readonly progress?: { readonly durationMs: number; readonly positionMs: number };
  readonly quality: string;
  readonly rewindSeconds?: number;
  readonly seekable: boolean;
}) {
  const pipStatus = pictureInPictureStatusCopy(pipPhase);
  const pipBusy = pipPhase === "requesting" || pipPhase === "active";
  const showQuality = chrome?.showQuality !== false;
  const showVolume = chrome?.showVolume !== false;
  const showFullscreen = chrome?.showFullscreen !== false;
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.rail}>
        <View style={styles.row}>
        <Control
          label={paused ? "Play" : "Pause"}
          onPress={onPlayPause}
          testID="player-play-pause"
        />
        {seekable && onSeekBack && onSeekForward ? (
          <SeekControls
            fastForwardSeconds={fastForwardSeconds}
            onSeekBack={onSeekBack}
            onSeekForward={onSeekForward}
            rewindSeconds={rewindSeconds}
          />
        ) : null}
        {showVolume ? (
          <Control
            label={muted ? "Unmute" : "Mute"}
            onPress={onMute}
            testID="player-mute"
          />
        ) : null}
        {showQuality ? (
          <Control
            label={`Quality ${quality}`}
            onPress={onQuality}
            testID="player-quality"
          />
        ) : null}
        {showFullscreen ? (
          <Control
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onPress={onFullscreen}
            testID="player-fullscreen"
          />
        ) : null}
        <Control
          disabled={!pipAvailable || pipBusy}
          label={pipControlLabel(pipAvailable, pipPhase)}
          onPress={onPip}
          testID="player-pip"
        />
      </View>
      {seekable && progress ? (
        <Text selectable style={styles.status} testID="player-progress">
          {`${formatClock(progress.positionMs)} / ${formatClock(progress.durationMs)}`}
        </Text>
      ) : null}
      {pipStatus ? (
        <Text selectable style={styles.status} testID="player-pip-status">
          {pipStatus}
        </Text>
      ) : null}
      {fullscreen ? (
        <Text selectable style={styles.status} testID="player-fullscreen-status">
          {FULLSCREEN_LIFECYCLE_COPY}
        </Text>
      ) : null}
      {seekable ? null : (
        <Text selectable style={styles.limitation}>
          Live playback cannot seek or change speed. Theater and stats stay
          unavailable until those capabilities ship.
        </Text>
      )}
      </View>
    </View>
  );
}

function SeekControls({
  fastForwardSeconds,
  onSeekBack,
  onSeekForward,
  rewindSeconds,
}: {
  readonly fastForwardSeconds: number;
  readonly onSeekBack: () => void;
  readonly onSeekForward: () => void;
  readonly rewindSeconds: number;
}) {
  return (
    <>
      <Control
        label={`Back ${rewindSeconds} seconds`}
        onPress={onSeekBack}
        testID="player-seek-back"
      />
      <Control
        label={`Forward ${fastForwardSeconds} seconds`}
        onPress={onSeekForward}
        testID="player-seek-forward"
      />
    </>
  );
}

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function pipControlLabel(
  pipAvailable: boolean,
  pipPhase: PictureInPicturePhase,
): string {
  if (pipPhase === "requesting") return "PiP requesting";
  if (pipPhase === "active") return "PiP active";
  if (pipPhase === "failed") return "PiP failed";
  if (pipPhase === "returned") return "PiP returned";
  if (!pipAvailable || pipPhase === "unavailable") return "PiP unavailable";
  return "Picture in Picture";
}

function Control({
  disabled = false,
  label,
  onPress,
  testID,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: mobileColors.navigationSelected }}
      style={({ pressed }) => [
        styles.control,
        pressed && !disabled ? styles.controlPressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <Text selectable style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  rail: {
    backgroundColor: mobileColors.playerScrim,
    gap: mobileSpacing.xSmall,
    padding: mobileSpacing.small,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  control: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  controlPressed: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...mobileType.label,
    color: mobileColors.textPrimary,
  },
  status: {
    ...mobileType.caption,
    marginTop: mobileSpacing.xSmall,
  },
  limitation: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
    marginTop: mobileSpacing.xSmall,
  },
});
