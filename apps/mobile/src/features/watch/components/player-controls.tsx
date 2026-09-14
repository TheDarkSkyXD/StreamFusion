import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { PictureInPicturePhase } from "../capabilities/watch";
import {
  FULLSCREEN_LIFECYCLE_COPY,
  pictureInPictureStatusCopy,
} from "../domain/player-presentation";

export function PlayerControls({
  fullscreen,
  muted,
  onFullscreen,
  onMute,
  onPip,
  onPlayPause,
  onQuality,
  paused,
  pipAvailable,
  pipPhase,
  quality,
}: {
  readonly fullscreen: boolean;
  readonly muted: boolean;
  readonly onFullscreen: () => void;
  readonly onMute: () => void;
  readonly onPip: () => void;
  readonly onPlayPause: () => void;
  readonly onQuality: () => void;
  readonly paused: boolean;
  readonly pipAvailable: boolean;
  readonly pipPhase: PictureInPicturePhase;
  readonly quality: string;
}) {
  const pipStatus = pictureInPictureStatusCopy(pipPhase);
  const pipBusy = pipPhase === "requesting" || pipPhase === "active";
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.row}>
        <Control
          label={paused ? "Play" : "Pause"}
          onPress={onPlayPause}
          testID="player-play-pause"
        />
        <Control
          label={muted ? "Unmute" : "Mute"}
          onPress={onMute}
          testID="player-mute"
        />
        <Control
          label={`Quality ${quality}`}
          onPress={onQuality}
          testID="player-quality"
        />
        <Control
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onPress={onFullscreen}
          testID="player-fullscreen"
        />
        <Control
          disabled={!pipAvailable || pipBusy}
          label={pipControlLabel(pipAvailable, pipPhase)}
          onPress={onPip}
          testID="player-pip"
        />
      </View>
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
      <Text selectable style={styles.limitation}>
        Live playback cannot seek or change speed. Captions, theater, and stats
        stay unavailable until those capabilities ship.
      </Text>
    </View>
  );
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
      style={[styles.control, disabled ? styles.disabled : null]}
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
    backgroundColor: "rgba(15,15,15,0.35)",
    justifyContent: "flex-end",
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
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  status: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: mobileSpacing.xSmall,
  },
  limitation: {
    color: mobileColors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: mobileSpacing.xSmall,
  },
});
