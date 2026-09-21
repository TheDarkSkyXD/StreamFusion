import {
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import type { PictureInPicturePhase } from "../capabilities/watch";

const CENTER_PLAY_ICON = 40;
const CENTER_SEEK_ICON = 28;
const CENTER_PLAY_HIT = 64;

/**
 * Mobile Watch player chrome — center transport + bottom utility rail.
 *
 * Capability gaps intentionally not shown on-player (keep docs/comments only):
 * theater mode, video stats, volume slider, and playback speed are desktop-only
 * for now. Mute toggles audio; quality opens a compact sheet.
 */
export function PlayerControls({
  chrome,
  fullscreen,
  muted,
  onFullscreen,
  onMute,
  onPip,
  onPlayPause,
  onQualityPress,
  onSeekBack,
  onSeekForward,
  onSelectQuality,
  onPlayerTap,
  onToggleVisible,
  paused,
  pipAvailable,
  pipPhase,
  progress,
  qualities = [],
  quality,
  qualityMenuOpen = false,
  onCloseQualityMenu,
  rewindSeconds = 10,
  fastForwardSeconds = 10,
  seekable,
  visible = true,
}: {
  readonly chrome?: {
    readonly showFullscreen: boolean;
    readonly showQuality: boolean;
    readonly showVolume: boolean;
  };
  readonly fastForwardSeconds?: number;
  readonly fullscreen: boolean;
  readonly muted: boolean;
  readonly onCloseQualityMenu?: () => void;
  readonly onFullscreen: () => void;
  readonly onMute: () => void;
  readonly onPip: () => void;
  readonly onPlayPause: () => void;
  readonly onQualityPress: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly onSelectQuality?: (quality: string) => void;
  readonly onPlayerTap?: () => void;
  readonly onToggleVisible: () => void;
  readonly paused: boolean;
  readonly pipAvailable: boolean;
  readonly pipPhase: PictureInPicturePhase;
  readonly progress?: { readonly durationMs: number; readonly positionMs: number };
  readonly qualities?: readonly string[];
  readonly quality: string;
  readonly qualityMenuOpen?: boolean;
  readonly rewindSeconds?: number;
  readonly seekable: boolean;
  readonly visible?: boolean;
}) {
  const pipBusy = pipPhase === "requesting" || pipPhase === "active";
  const showQuality = chrome?.showQuality !== false;
  const showVolume = chrome?.showVolume !== false;
  const showFullscreen = chrome?.showFullscreen !== false;
  const live = !seekable;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Pressable
        accessibilityLabel={visible ? "Hide player controls" : "Show player controls"}
        accessibilityRole="button"
        onPress={() => {
          onPlayerTap?.();
          onToggleVisible();
        }}
        style={styles.tapCatcher}
        testID="player-chrome-toggle"
      />
      {visible ? (
        <>
          <View
            pointerEvents="box-none"
            style={styles.centerTransport}
            testID="player-center-transport"
          >
            {seekable && onSeekBack ? (
              <IconControl
                Icon={RotateCcw}
                accessibilityLabel={`Back ${rewindSeconds} seconds`}
                badge={String(rewindSeconds)}
                iconSize={CENTER_SEEK_ICON}
                onPress={onSeekBack}
                testID="player-seek-back"
              />
            ) : null}
            <IconControl
              Icon={paused ? Play : Pause}
              accessibilityLabel={paused ? "Play" : "Pause"}
              hitSize={CENTER_PLAY_HIT}
              iconSize={CENTER_PLAY_ICON}
              onPress={onPlayPause}
              testID="player-play-pause"
            />
            {seekable && onSeekForward ? (
              <IconControl
                Icon={RotateCw}
                accessibilityLabel={`Forward ${fastForwardSeconds} seconds`}
                badge={String(fastForwardSeconds)}
                iconSize={CENTER_SEEK_ICON}
                onPress={onSeekForward}
                testID="player-seek-forward"
              />
            ) : null}
          </View>
          <View pointerEvents="box-none" style={styles.railWrap}>
            <View pointerEvents="none" style={styles.scrim} />
            <View style={styles.rail} testID="player-controls-rail">
              {seekable && progress ? (
                <Text selectable style={styles.progress} testID="player-progress">
                  {`${formatClock(progress.positionMs)} / ${formatClock(progress.durationMs)}`}
                </Text>
              ) : null}
              <View style={styles.row}>
                <View style={styles.left}>
                  {showVolume ? (
                    <IconControl
                      Icon={muted ? VolumeX : Volume2}
                      accessibilityLabel={muted ? "Unmute" : "Mute"}
                      onPress={onMute}
                      testID="player-mute"
                    />
                  ) : null}
                  {live ? (
                    <View style={styles.liveBadge} testID="player-live-badge">
                      <View style={styles.liveDot} />
                      <Text style={styles.liveLabel}>LIVE</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.right}>
                  {showQuality ? (
                    <IconControl
                      Icon={Settings2}
                      accessibilityLabel={`Quality ${quality}`}
                      onPress={onQualityPress}
                      testID="player-quality"
                    />
                  ) : null}
                  <IconControl
                    Icon={PictureInPicture2}
                    accessibilityLabel={pipAccessibilityLabel(pipAvailable, pipPhase)}
                    disabled={!pipAvailable || pipBusy}
                    onPress={onPip}
                    testID="player-pip"
                  />
                  {showFullscreen ? (
                    <IconControl
                      Icon={fullscreen ? Minimize : Maximize}
                      accessibilityLabel={
                        fullscreen ? "Exit fullscreen" : "Fullscreen"
                      }
                      onPress={onFullscreen}
                      testID="player-fullscreen"
                    />
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        </>
      ) : null}
      {showQuality && qualityMenuOpen && onSelectQuality && onCloseQualityMenu ? (
        <QualitySheet
          onClose={onCloseQualityMenu}
          onSelect={onSelectQuality}
          qualities={qualities.length > 0 ? qualities : [quality]}
          selected={quality}
        />
      ) : null}
    </View>
  );
}

function QualitySheet({
  onClose,
  onSelect,
  qualities,
  selected,
}: {
  readonly onClose: () => void;
  readonly onSelect: (quality: string) => void;
  readonly qualities: readonly string[];
  readonly selected: string;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.sheetBackdrop}>
        <Pressable
          accessibilityLabel="Dismiss quality menu"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          testID="player-quality-dismiss"
        />
        <View style={styles.sheet} testID="player-quality-menu">
          <Text selectable style={styles.sheetTitle}>
            Quality
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
            {qualities.map((option) => {
              const active = option === selected;
              return (
                <Pressable
                  accessibilityLabel={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={option}
                  onPress={() => {
                    onSelect(option);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    active ? styles.sheetOptionActive : null,
                    pressed ? styles.sheetOptionPressed : null,
                  ]}
                  testID={`player-quality-option-${option}`}
                >
                  <Text
                    selectable
                    style={[
                      styles.sheetOptionLabel,
                      active ? styles.sheetOptionLabelActive : null,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function IconControl({
  Icon,
  accessibilityLabel,
  badge,
  disabled = false,
  hitSize = mobileSizing.minimumTouchTarget,
  iconSize = mobileSizing.icon,
  onPress,
  testID,
}: {
  readonly Icon: LucideIcon;
  readonly accessibilityLabel: string;
  readonly badge?: string;
  readonly disabled?: boolean;
  readonly hitSize?: number;
  readonly iconSize?: number;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
      style={({ pressed }) => [
        styles.iconHit,
        { height: hitSize, width: hitSize },
        pressed && !disabled ? styles.iconHitPressed : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        <Icon
          accessibilityElementsHidden
          color={mobileColors.textPrimary}
          size={iconSize}
          strokeWidth={2.25}
        />
        {badge ? (
          <Text style={styles.seekBadge} importantForAccessibility="no">
            {badge}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function pipAccessibilityLabel(
  pipAvailable: boolean,
  pipPhase: PictureInPicturePhase,
): string {
  if (pipPhase === "requesting") return "Picture in Picture requesting";
  if (pipPhase === "active") return "Picture in Picture active";
  if (pipPhase === "failed") return "Picture in Picture failed";
  if (pipPhase === "returned") return "Picture in Picture returned";
  if (!pipAvailable || pipPhase === "unavailable") {
    return "Picture in Picture unavailable";
  }
  return "Picture in Picture";
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  tapCatcher: {
    ...StyleSheet.absoluteFill,
  },
  centerTransport: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.large,
    justifyContent: "center",
    zIndex: 1,
  },
  railWrap: {
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
  },
  scrim: {
    backgroundColor: "rgba(0,0,0,0.72)",
    bottom: 0,
    height: 96,
    left: 0,
    position: "absolute",
    right: 0,
  },
  rail: {
    gap: mobileSpacing.xSmall,
    paddingBottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingTop: mobileSpacing.medium,
    zIndex: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  left: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: mobileSpacing.xSmall,
  },
  right: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
  },
  iconHit: {
    alignItems: "center",
    borderRadius: mobileRadii.full,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget,
  },
  iconHitPressed: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  seekBadge: {
    ...mobileType.label,
    color: mobileColors.textPrimary,
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 10,
    marginTop: -14,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  progress: {
    ...mobileType.caption,
    color: mobileColors.textPrimary,
    fontWeight: "700",
    marginBottom: mobileSpacing.xSmall,
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.small,
    flexDirection: "row",
    gap: 6,
    marginLeft: mobileSpacing.xSmall,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: 4,
  },
  liveDot: {
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.full,
    height: 6,
    width: 6,
  },
  liveLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    lineHeight: 14,
  },
  sheetBackdrop: {
    backgroundColor: mobileColors.overlay,
    flex: 1,
    justifyContent: "flex-end",
    padding: mobileSpacing.medium,
  },
  sheet: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    maxHeight: "50%",
    paddingBottom: mobileSpacing.small,
    paddingTop: mobileSpacing.medium,
  },
  sheetTitle: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    lineHeight: 16,
    paddingBottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetOption: {
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  sheetOptionActive: {
    backgroundColor: mobileColors.surfaceMuted,
  },
  sheetOptionPressed: {
    backgroundColor: mobileColors.surfaceRaised,
  },
  sheetOptionLabel: {
    color: mobileColors.textSecondary,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
  },
  sheetOptionLabelActive: {
    color: mobileColors.textPrimary,
    fontWeight: "700",
  },
});
