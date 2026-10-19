import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  UserRound,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";

import { impactHaptic } from "@mobile/design/haptics";
import {
  mobileColors,
  mobileHitSlop,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import { MobileSettingsIcon } from "@mobile/design/settings-icon";
import { formatWatchLiveMetaParts } from "../domain/watch-live-meta";

const RAIL_ICON = 26;
const RAIL_HIT = 48;
const RECORDED_CONTROL_SPACING = 72;

export function PlayerControls({
  adBlockStatus = null,
  chrome,
  fullscreen,
  live: liveProp,
  liveMeta,
  muted,
  onBack,
  onFullscreen,
  onMute,
  onPlayPause,
  onSettingsPress,
  onSeekBack,
  onSeekForward,
  onSeekTo,
  onToggleVisible,
  paused,
  progress,
  rewindSeconds = 10,
  fastForwardSeconds = 10,
  seekable,
  platform = "twitch",
  volume = 1,
  visible = true,
}: {
  readonly adBlockStatus?: {
    readonly isActive: boolean;
    readonly isShowingAd: boolean;
  } | null;
  readonly chrome?: {
    readonly showFullscreen: boolean;
  };
  readonly fastForwardSeconds?: number;
  readonly fullscreen: boolean;
  readonly live?: boolean;
  readonly liveMeta?: {
    readonly startedAt: string | null;
    readonly viewerCount: number;
  } | null;
  readonly muted: boolean;
  readonly onBack?: () => void;
  readonly onFullscreen: () => void;
  readonly onMute: () => void;
  readonly onPlayPause: () => void;
  readonly onSettingsPress: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly onSeekTo?: (positionMs: number) => void;
  readonly onToggleVisible: () => void;
  readonly paused: boolean;
  readonly platform?: "kick" | "twitch";
  readonly progress?: {
    readonly durationMs: number;
    readonly positionMs: number;
  };
  readonly rewindSeconds?: number;
  readonly seekable: boolean;
  readonly volume?: number;
  readonly visible?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const showFullscreen = fullscreen || chrome?.showFullscreen !== false;
  const live = liveProp ?? !seekable;
  const recordedSeekable = !live && seekable;
  const { i18n, t } = useTranslation();

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Pressable
        accessibilityLabel={
          visible
            ? t("playback.watch.hideControls")
            : t("playback.watch.showControls")
        }
        accessibilityRole="button"
        onPress={onToggleVisible}
        style={styles.tapCatcher}
        testID="player-chrome-toggle"
      />
      {visible ? (
        <>
          <View
            pointerEvents="none"
            style={styles.scrim}
            testID="player-scrim"
          />
          {onBack ? (
            <Pressable
              accessibilityLabel={
                fullscreen ? t("playback.watch.exitFullscreen") : "Back"
              }
              accessibilityRole="button"
              onPress={onBack}
              style={[
                styles.stageBack,
                fullscreen
                  ? {
                      left: Math.max(insets.left, mobileSpacing.small),
                      top: Math.max(insets.top, mobileSpacing.small),
                    }
                  : null,
              ]}
              testID="watch-back"
            >
              <ChevronDown
                color={mobileColors.textPrimary}
                size={26}
                strokeWidth={2.5}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={t("playback.settings")}
            accessibilityRole="button"
            onPress={() => {
              void impactHaptic("light");
              onSettingsPress();
            }}
            style={[
              styles.stageSettings,
              fullscreen
                ? {
                    right: Math.max(insets.right, mobileSpacing.small),
                    top: Math.max(insets.top, mobileSpacing.small),
                  }
                : null,
            ]}
            testID="player-settings"
          >
            <MobileSettingsIcon />
          </Pressable>
          <View
            pointerEvents="box-none"
            style={styles.recordedTransport}
            testID={
              live ? "player-live-transport" : "player-recorded-transport"
            }
          >
            <View
              pointerEvents="box-none"
              style={styles.recordedTransportButtons}
            >
              <View pointerEvents="box-none" style={styles.transportSlot}>
                {recordedSeekable && onSeekBack ? (
                  <IconControl
                    Icon={RotateCcw}
                    accessibilityLabel={t("playback.watch.seekBack", {
                      seconds: rewindSeconds,
                    })}
                    badge={String(rewindSeconds)}
                    onPress={onSeekBack}
                    testID="player-seek-back"
                  />
                ) : null}
              </View>
              <View pointerEvents="box-none" style={styles.transportSlot}>
                <IconControl
                  Icon={paused ? Play : Pause}
                  accessibilityLabel={
                    paused ? t("playback.play") : t("playback.pause")
                  }
                  filled
                  iconSize={24}
                  strokeWidth={0}
                  onPress={onPlayPause}
                  testID="player-play-pause"
                />
              </View>
              <View pointerEvents="box-none" style={styles.transportSlot}>
                {recordedSeekable && onSeekForward ? (
                  <IconControl
                    Icon={RotateCw}
                    accessibilityLabel={t("playback.watch.seekForward", {
                      seconds: fastForwardSeconds,
                    })}
                    badge={String(fastForwardSeconds)}
                    onPress={onSeekForward}
                    testID="player-seek-forward"
                  />
                ) : null}
              </View>
            </View>
          </View>
          <View
            pointerEvents="box-none"
            style={[
              styles.rail,
              fullscreen
                ? {
                    paddingBottom: Math.max(insets.bottom, mobileSpacing.small),
                    paddingLeft: Math.max(insets.left, mobileSpacing.small),
                    paddingRight: Math.max(insets.right, mobileSpacing.small),
                  }
                : null,
            ]}
            testID="player-controls-rail"
          >
            <View style={styles.row}>
              <View style={styles.left}>
                {live && liveMeta ? (
                  <LivePlayerMeta
                    {...liveMeta}
                    locale={i18n.resolvedLanguage ?? i18n.language ?? "en"}
                  />
                ) : null}
                {live && !liveMeta ? (
                  <View
                    style={[
                      styles.liveBadge,
                      platform === "kick" ? styles.kickLiveBadge : null,
                    ]}
                    testID="player-live-badge"
                  >
                    <View
                      style={[
                        styles.liveDot,
                        platform === "kick" ? styles.kickLiveDot : null,
                      ]}
                    />
                    <Text style={styles.liveLabel}>{t("playback.live")}</Text>
                  </View>
                ) : null}
                {adBlockStatus?.isActive ? (
                  <View
                    accessibilityLabel={
                      adBlockStatus.isShowingAd
                        ? t("playback.blockingAds")
                        : t("playback.adBlockActive")
                    }
                    accessibilityHint={
                      adBlockStatus.isShowingAd
                        ? t("playback.blockingAds2")
                        : t("playback.adBlockActive2")
                    }
                    accessibilityRole="image"
                    style={styles.adblockShield}
                    testID="player-adblock-shield"
                  >
                    <ShieldCheck
                      accessibilityElementsHidden
                      color={
                        adBlockStatus.isShowingAd
                          ? "#22c55e"
                          : "rgba(255,255,255,0.7)"
                      }
                      size={RAIL_ICON}
                      strokeWidth={2.25}
                    />
                  </View>
                ) : null}
              </View>
              <View style={styles.right}>
                <IconControl
                  Icon={
                    muted || volume === 0
                      ? VolumeX
                      : volume < 0.5
                        ? Volume1
                        : Volume2
                  }
                  accessibilityLabel={
                    muted ? t("playback.unmute") : t("playback.mute")
                  }
                  filled
                  onPress={onMute}
                  testID="player-mute"
                />
                {showFullscreen ? (
                  <Pressable
                    accessibilityLabel={
                      fullscreen
                        ? t("playback.watch.exitFullscreen")
                        : t("playback.watch.fullscreen")
                    }
                    accessibilityRole="button"
                    onPress={onFullscreen}
                    style={styles.iconHit}
                    testID="player-fullscreen"
                  >
                    <RotatePhoneIcon />
                  </Pressable>
                ) : null}
              </View>
            </View>
            {recordedSeekable && progress ? (
              <ProgressScrubber
                color={
                  platform === "kick" ? mobileColors.kick : mobileColors.twitch
                }
                durationMs={progress.durationMs}
                positionMs={progress.positionMs}
                {...(onSeekTo === undefined ? {} : { onSeekTo })}
              />
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function LivePlayerMeta({
  locale,
  startedAt,
  viewerCount,
}: {
  readonly locale: string;
  readonly startedAt: string | null;
  readonly viewerCount: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const meta = formatWatchLiveMetaParts(viewerCount, startedAt, now, locale);
  return (
    <View style={styles.liveMeta}>
      {meta.uptime ? (
        <View style={styles.metaPart} testID="player-live-uptime">
          <View style={styles.metaLiveDot} />
          <Text style={styles.metaText}>{meta.uptime}</Text>
        </View>
      ) : null}
      <View style={styles.metaPart} testID="player-live-viewers">
        <UserRound color={mobileColors.textPrimary} size={17} />
        <Text style={styles.metaText}>{meta.viewers}</Text>
      </View>
    </View>
  );
}

export function RotatePhoneIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 32 32" fill="none">
      <Rect
        x={11}
        y={9}
        width={11}
        height={16}
        rx={1.5}
        stroke={mobileColors.textPrimary}
        strokeWidth={2.3}
        transform="rotate(-42 16.5 17)"
      />
      <Path
        d="M4 10a14 14 0 0 1 16-7m0 0-3 1m3-1-1 3M28 22a14 14 0 0 1-16 7m0 0 3-1m-3 1 1-3"
        stroke={mobileColors.textPrimary}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
function IconControl({
  Icon,
  accessibilityLabel,
  badge,
  filled = false,
  hitSize = RAIL_HIT,
  iconSize = RAIL_ICON,
  onPress,
  strokeWidth = 2.25,
  testID,
}: {
  readonly Icon: LucideIcon;
  readonly accessibilityLabel: string;
  readonly badge?: string;
  readonly filled?: boolean;
  readonly hitSize?: number;
  readonly iconSize?: number;
  readonly onPress: () => void;
  readonly strokeWidth?: number;
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
      android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
      style={({ pressed }) => [
        styles.iconHit,
        { height: hitSize, width: hitSize },
        pressed ? styles.iconHitPressed : null,
      ]}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        <Icon
          accessibilityElementsHidden
          color={mobileColors.textPrimary}
          fill={filled ? mobileColors.textPrimary : "none"}
          size={iconSize}
          strokeWidth={strokeWidth}
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

function ProgressScrubber({
  color,
  durationMs,
  onSeekTo,
  positionMs,
}: {
  readonly color: string;
  readonly durationMs: number;
  readonly onSeekTo?: (positionMs: number) => void;
  readonly positionMs: number;
}) {
  const ratio =
    durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;
  const widthRef = useRef(0);
  return (
    <View style={styles.scrubberBlock}>
      <Text selectable style={styles.progress} testID="player-progress">
        {`${formatClock(positionMs)} / ${formatClock(durationMs)}`}
      </Text>
      <Pressable
        accessibilityLabel="Seek"
        accessibilityRole="adjustable"
        disabled={onSeekTo === undefined || durationMs <= 0}
        onLayout={(event) => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        onPress={(event) => {
          if (!onSeekTo || durationMs <= 0 || widthRef.current <= 0) return;
          const next = Math.min(
            durationMs,
            Math.max(
              0,
              (event.nativeEvent.locationX / widthRef.current) * durationMs,
            ),
          );
          onSeekTo(next);
        }}
        style={styles.scrubberHit}
        testID="player-scrubber"
      >
        <View style={styles.scrubberTrack}>
          <View
            style={[
              styles.scrubberFill,
              { backgroundColor: color, width: `${ratio * 100}%` },
            ]}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.scrubberThumb,
            { marginLeft: -6, left: `${ratio * 100}%` },
          ]}
        />
      </Pressable>
    </View>
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

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  tapCatcher: {
    ...StyleSheet.absoluteFill,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.46)",
  },
  stageBack: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    left: mobileSpacing.small,
    position: "absolute",
    top: mobileSpacing.small,
    width: 48,
    zIndex: 3,
  },
  stageSettings: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: mobileSpacing.small,
    top: mobileSpacing.small,
    width: 48,
    zIndex: 3,
  },
  liveMeta: { alignItems: "center", flexDirection: "row", gap: 6 },
  metaPart: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: mobileRadii.small,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  metaText: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  metaLiveDot: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.full,
    height: 8,
    width: 8,
  },
  recordedTransport: {
    alignItems: "center",
    left: 0,
    marginTop: -RAIL_HIT / 2,
    position: "absolute",
    right: 0,
    top: "50%",
    zIndex: 1,
  },
  recordedTransportButtons: {
    flexDirection: "row",
    width: RECORDED_CONTROL_SPACING * 3,
  },
  transportSlot: {
    alignItems: "center",
    flex: 1,
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
    flexWrap: "wrap",
    justifyContent: "space-between",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  left: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
  },
  right: {
    alignItems: "center",
    flexDirection: "row",
    marginLeft: "auto",
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
  scrubberBlock: {
    gap: 6,
    marginBottom: mobileSpacing.xSmall,
  },
  scrubberHit: {
    height: 24,
    justifyContent: "center",
    width: "100%",
  },
  scrubberTrack: {
    backgroundColor: "rgba(255,255,255,0.28)",
    borderRadius: mobileRadii.full,
    height: 4,
    overflow: "hidden",
    width: "100%",
  },
  scrubberFill: {
    height: "100%",
  },
  scrubberThumb: {
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.full,
    height: 12,
    position: "absolute",
    top: 6,
    width: 12,
  },
  progress: {
    ...mobileType.caption,
    color: mobileColors.textPrimary,
    fontWeight: "700",
  },
  adblockShield: {
    alignItems: "center",
    height: RAIL_HIT,
    justifyContent: "center",
    width: RAIL_HIT,
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.small,
    flexDirection: "row",
    gap: 6,
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
  kickLiveBadge: {
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  kickLiveDot: {
    backgroundColor: mobileColors.kick,
  },
});
