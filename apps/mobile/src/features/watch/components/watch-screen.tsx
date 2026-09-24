import { useTranslation } from "react-i18next";
import { ArrowLeft, Heart } from "lucide-react-native";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState, type ComponentType } from "react";
import type { Stream } from "@streamfusion/core/content";
import type {
  MediaJobCommandName,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import type { AdBlockSession, AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxySession } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";

import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type { WatchChatSession } from "@mobile/features/chat/capabilities/watch-chat";
import type {
  FocusedWatchState,
  WatchChatAvailability,
  WatchInspection,
  WatchPeek,
  WatchRuntime,
  WatchTab,
  WatchTarget,
} from "../capabilities/watch";
import { composeWatchView, resolveWatchCopy } from "../domain/watch-view";
import { watchAdBlockStatus } from "../domain/adblock-playback-status";
import {
  formatLiveUptime,
  formatWatchViewerCount,
} from "../domain/watch-live-meta";
import { isPictureInPictureSurface } from "../domain/player-presentation";
import type { WatchDownloadEligibility } from "../domain/watch-download";
import type { WatchRecordingEligibility } from "../domain/watch-recording";
import { PlayerControls } from "./player-controls";
import { WatchCaptionBar, type WatchCaptionBarProps } from "./watch-caption-bar";
import { WatchCaptionOverlay } from "./watch-caption-overlay";
import { WatchDownloadBar } from "./watch-download-bar";
import { WatchRecordingBar } from "./watch-recording-bar";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import { HomeLiveDiscoveryScreen } from "@mobile/features/discovery/components/home-live-discovery-screen";
import { WatchTabs } from "./watch-tabs";

export type PlayerSurfaceProps = {
  readonly sessionId: string;
  readonly testID?: string;
};

export type WatchScreenRuntime = {
  readonly adblock?: AdBlockSession;
  readonly playlistProxy?: TwitchPlaylistProxySession;
  readonly chat: WatchChatSession;
  readonly history: WatchHistoryRepository;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly runtime: WatchRuntime;
};

export type WatchCaptionControls = WatchCaptionBarProps & {
  readonly cueText: string;
};

export type WatchMediaJobControls<Eligibility> = {
  readonly busy: boolean;
  readonly eligibility: Eligibility;
  readonly job: MediaJobSnapshot | null;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onOpenArtifact: () => void;
  readonly onStart: () => void;
  readonly status?: string | null;
};

export function WatchScreen({
  PlayerSurface,
  adblockView,
  playlistProxyActive = false,
  captions,
  chat,
  chrome,
  download,
  recording,
  inspection,
  onChatRetry,
  followBusy = false,
  followed = false,
  onBack,
  onFollow,
  onOpenChannel,
  onOpenRelated,
  onPlayerTap,
  onRetry,
  onSelectTab,
  onMute,
  onPip,
  onPlayPause,
  onQualityPress,
  onCloseQualityMenu,
  onSelectQuality,
  onSeekBack,
  onSeekForward,
  onSeekTo,
  onToggleFullscreen,
  onToggleControls,
  controlsVisible = true,
  qualityMenuOpen = false,
  peek,
  playback,
  rewindSeconds,
  fastForwardSeconds,
  tab,
  target,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly adblockView?: AdBlockView | null;
  readonly playlistProxyActive?: boolean;
  readonly captions?: WatchCaptionControls;
  readonly chat: WatchChatAvailability;
  readonly chrome?: {
    readonly showFullscreen: boolean;
    readonly showQuality: boolean;
    readonly showVolume: boolean;
  };
  readonly controlsVisible?: boolean;
  readonly download?: WatchMediaJobControls<WatchDownloadEligibility>;
  readonly recording?: WatchMediaJobControls<WatchRecordingEligibility>;
  readonly inspection: WatchInspection | null;
  readonly followBusy?: boolean;
  readonly followed?: boolean;
  readonly onBack?: () => void;
  readonly onChatRetry?: () => void;
  readonly onCloseQualityMenu?: () => void;
  readonly onFollow?: () => void;
  readonly onOpenChannel?: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onPlayerTap?: () => void;
  readonly onRetry: () => void;
  readonly onSelectQuality?: (quality: string) => void;
  readonly onSelectTab: (tab: WatchTab) => void;
  readonly onMute?: () => void;
  readonly onPip?: () => void;
  readonly onPlayPause?: () => void;
  readonly onQualityPress?: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly onSeekTo?: (positionMs: number) => void;
  readonly onToggleControls?: () => void;
  readonly onToggleFullscreen?: () => void;
  readonly peek?: WatchPeek;
  readonly playback: FocusedWatchState;
  readonly qualityMenuOpen?: boolean;
  readonly rewindSeconds?: number;
  readonly fastForwardSeconds?: number;
  readonly tab: WatchTab;
  readonly target: WatchTarget;
}) {
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  const view = composeWatchView(playback);
  const title = resolveWatchCopy(view.title, translate);
  const detail = resolveWatchCopy(view.detail, translate);
  const fullscreen =
    peek?.kind === "active" && peek.presentation.presentation === "fullscreen";
  const pipSurface =
    peek?.kind === "active" && isPictureInPictureSurface(peek.presentation);
  const showControls =
    peek?.kind === "active" &&
    !pipSurface &&
    onMute &&
    onPip &&
    onPlayPause &&
    onQualityPress &&
    onToggleFullscreen &&
    onToggleControls;
  const avatarUrl = channelAvatarUrl(inspection);
  const displayName = channelDisplayName(inspection, target.channelName);
  const liveMeta = liveMetaStream(inspection);
  return (
    <View
      style={[styles.screen, pipSurface ? styles.pipScreen : null]}
      testID="screen-watch"
    >
      {pipSurface ? null : (
        <View style={styles.meta} testID="watch-channel-chrome">
          {onBack ? (
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onBack}
              style={styles.metaIconHit}
              testID="watch-back"
            >
              <ArrowLeft
                accessibilityElementsHidden
                color={mobileColors.textPrimary}
                size={22}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityHint={t("playback.watch.openChannelHint")}
            accessibilityLabel={t("playback.watch.openChannel", {
              name: displayName,
            })}
            accessibilityRole="button"
            disabled={onOpenChannel === undefined}
            onPress={onOpenChannel}
            style={({ pressed }) => [
              styles.metaIdentity,
              pressed ? styles.metaPressed : null,
            ]}
            testID="watch-open-channel"
          >
            {avatarUrl ? (
              <Image
                accessibilityIgnoresInvertColors
                source={{ uri: avatarUrl }}
                style={styles.avatar}
              />
            ) : (
              <View
                style={styles.avatar}
                testID="watch-channel-avatar-placeholder"
              />
            )}
            <View style={styles.metaCopy}>
              <View style={styles.metaNameRow}>
                <Text selectable style={styles.metaName} testID="watch-target">
                  {displayName}
                </Text>
                {channelIsVerified(inspection) ? (
                  <MobileVerifiedBadge platform={target.platform} />
                ) : null}
              </View>
              {liveMeta ? (
                <WatchMetaViewers
                  startedAt={liveMeta.startedAt}
                  viewerCount={liveMeta.viewerCount}
                />
              ) : (
                <MobilePlatformBadge platform={target.platform} />
              )}
            </View>
          </Pressable>
          {onFollow ? (
            <Pressable
              accessibilityLabel={followed ? "Unfollow" : "Follow"}
              accessibilityRole="button"
              accessibilityState={{ busy: followBusy, selected: followed }}
              disabled={followBusy}
              onPress={onFollow}
              style={({ pressed }) => [
                styles.followButton,
                followed ? styles.followButtonActive : null,
                pressed ? styles.followButtonPressed : null,
                followBusy ? styles.followButtonBusy : null,
              ]}
              testID="watch-follow"
            >
              <Heart
                accessibilityElementsHidden
                color={mobileColors.textPrimary}
                fill={followed ? mobileColors.textPrimary : "transparent"}
                size={18}
              />
            </Pressable>
          ) : null}
        </View>
      )}
      <View
        style={[
          styles.playerStage,
          fullscreen || pipSurface ? styles.fullscreenStage : null,
        ]}
        testID="watch-player-stage"
      >
        {view.showPlayer && view.sessionId ? (
          <PlayerSurface sessionId={view.sessionId} testID="watch-player" />
        ) : (
          <View style={styles.placeholder}>
            <Text selectable style={mobileType.title}>
              {title}
            </Text>
            <Text selectable style={mobileType.body}>
              {detail}
            </Text>
          </View>
        )}
        {!showControls && onPlayerTap && !pipSurface ? (
          <Pressable
            accessibilityLabel={t("playback.watch.showStreamInfo")}
            accessibilityRole="button"
            onPress={onPlayerTap}
            style={StyleSheet.absoluteFill}
            testID="watch-player-tap"
          />
        ) : null}
        {showControls && peek.kind === "active" ? (
          <PlayerControls
            adBlockStatus={watchAdBlockStatus({
              adsDetected: peek.adsDetected,
              filteringActive: adblockFilteringActive(adblockView, target.platform),
              playlistProxyActive:
                playlistProxyActive && target.platform === "twitch",
            })}
            fullscreen={fullscreen}
            muted={peek.muted}
            onFullscreen={onToggleFullscreen}
            onMute={onMute}
            onPip={onPip}
            onPlayPause={onPlayPause}
            onQualityPress={onQualityPress}
            onToggleVisible={onToggleControls}
            {...(onPlayerTap === undefined ? {} : { onPlayerTap })}
            qualities={peek.qualities}
            qualityMenuOpen={qualityMenuOpen}
            visible={controlsVisible}
            {...(chrome === undefined ? {} : { chrome })}
            {...(fastForwardSeconds === undefined ? {} : { fastForwardSeconds })}
            {...(rewindSeconds === undefined ? {} : { rewindSeconds })}
            {...(onSeekBack === undefined ? {} : { onSeekBack })}
            {...(onSeekForward === undefined ? {} : { onSeekForward })}
            {...(onSeekTo === undefined ? {} : { onSeekTo })}
            {...(onSelectQuality === undefined ? {} : { onSelectQuality })}
            {...(onCloseQualityMenu === undefined ? {} : { onCloseQualityMenu })}
            paused={peek.state.phase === "paused"}
            pipAvailable={peek.state.session.pictureInPictureEligible}
            pipPhase={peek.presentation.pip}
            progress={peek.progress}
            quality={peek.quality}
            seekable={peek.progress.seekable}
          />
        ) : null}
        {pipSurface ? null : (
          <WatchCaptionOverlay text={captions?.cueText ?? ""} />
        )}
      </View>
      {pipSurface ? null : (
        <>
          {view.primaryAction === "retry" ? (
            <MobileButton
              accessibilityLabel={t("playback.retry")}
              onPress={onRetry}
              testID="watch-retry"
              variant="primary"
            >
              {t("playback.retry")}
            </MobileButton>
          ) : null}
          {tab === "info" && (download || recording || captions) ? (
            <View style={styles.toolsRow} testID="watch-tools">
              {download ? <WatchDownloadBar {...download} /> : null}
              {recording ? <WatchRecordingBar {...recording} /> : null}
              {captions ? <WatchCaptionBar compact {...captions} /> : null}
            </View>
          ) : null}
          <WatchTabs
            chat={chat}
            info={inspection?.info ?? null}
            onOpenRelated={onOpenRelated}
            onSelect={onSelectTab}
            recorded={Boolean(target.media)}
            related={inspection?.related ?? null}
            tab={tab}
            {...(onChatRetry === undefined ? {} : { onChatRetry })}
          />
        </>
      )}
    </View>
  );
}


function adblockFilteringActive(
  view: AdBlockView | null | undefined,
  platform: WatchTarget["platform"],
): boolean {
  if (!view || platform !== "twitch") return false;
  return view.enabled && view.policyAllowed;
}

function channelIsVerified(inspection: WatchInspection | null): boolean {
  const info = inspection?.info;
  if (!info || info.kind === "unavailable") return false;
  return info.channel.isVerified;
}

function liveMetaStream(
  inspection: WatchInspection | null,
): { readonly startedAt: string | null; readonly viewerCount: number } | null {
  const info = inspection?.info;
  if (!info || info.kind !== "live") return null;
  return {
    startedAt: info.stream.startedAt,
    viewerCount: info.stream.viewerCount,
  };
}

/**
 * Isolated ticking viewers · uptime line (desktop UptimeCounter pattern).
 * Twitch-style red live dot sits immediately before uptime when present.
 */
function WatchMetaViewers({
  startedAt,
  viewerCount,
}: {
  readonly startedAt: string | null;
  readonly viewerCount: number;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [uptime, setUptime] = useState(() =>
    formatLiveUptime(startedAt, Date.now()),
  );
  const viewers = formatWatchViewerCount(viewerCount, locale);

  useEffect(() => {
    const tick = () => {
      setUptime(formatLiveUptime(startedAt, Date.now()));
    };
    tick();
    if (!startedAt) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <View style={styles.metaViewersRow} testID="watch-meta-viewers">
      <Text selectable style={styles.metaViewers}>
        {viewers}
      </Text>
      {uptime === null ? null : (
        <>
          <Text selectable style={styles.metaViewers}>
            {" · "}
          </Text>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.metaLiveDot}
            testID="watch-meta-live-dot"
          />
          <Text selectable style={styles.metaViewers} testID="watch-meta-uptime">
            {uptime}
          </Text>
        </>
      )}
    </View>
  );
}

function channelAvatarUrl(inspection: WatchInspection | null): string | null {
  const info = inspection?.info;
  if (!info || info.kind === "unavailable") return null;
  return info.channel.avatarUrl ?? null;
}

function channelDisplayName(
  inspection: WatchInspection | null,
  fallback: string,
): string {
  const info = inspection?.info;
  if (!info || info.kind === "unavailable") return fallback;
  return info.channel.displayName;
}

export function WatchEmptyState({
  discovery,
  onOpenSearch,
}: {
  readonly discovery?: {
    readonly onOpenAccounts: () => void;
    readonly onSelectStream: (stream: Stream) => void;
    readonly session: DiscoverySession;
  };
  readonly onOpenSearch?: () => void;
} = {}) {
  const { t } = useTranslation();
  const findInSearch = onOpenSearch ? (
    <MobileButton
      accessibilityHint={t("playback.watch.findInSearchHint")}
      accessibilityLabel={t("playback.watch.findInSearch")}
      onPress={onOpenSearch}
      testID="watch-empty-open-search"
      variant="secondary"
    >
      {t("playback.watch.findInSearch")}
    </MobileButton>
  ) : null;

  if (discovery) {
    return (
      <View style={styles.scroll} testID="screen-watch">
        <HomeLiveDiscoveryScreen
          onOpenAccounts={discovery.onOpenAccounts}
          onSelectStream={discovery.onSelectStream}
          session={discovery.session}
          showTitle={false}
          title={t("navigation.watch")}
        />
      </View>
    );
  }

  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="screen-watch"
    >
      <MobileScreenHeader title={t("navigation.watch")} />
      {findInSearch}
      <MobileStatusPanel testID="watch-empty" tone="empty">
        <Text selectable style={mobileType.title}>
          {t("playback.watch.emptyTitle")}
        </Text>
        <Text selectable style={mobileType.body}>
          {t("playback.watch.emptyDetail")}
        </Text>
      </MobileStatusPanel>
    </MobileRefreshableScroll>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  screen: {
    flex: 1,
    gap: 0,
    minHeight: 0,
    padding: 0,
  },
  pipScreen: {
    gap: 0,
    padding: 0,
  },
  playerStage: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.background,
    borderRadius: 0,
    flexShrink: 0,
    overflow: "hidden",
    width: "100%",
  },
  toolsRow: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.small,
  },
  fullscreenStage: {
    ...StyleSheet.absoluteFill,
    aspectRatio: undefined,
    borderRadius: 0,
    zIndex: 30,
  },
  placeholder: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    justifyContent: "center",
    padding: mobileSpacing.large,
  },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
  },
  metaIconHit: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  metaIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minWidth: 0,
  },
  metaPressed: {
    opacity: 0.85,
  },
  metaCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  metaNameRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  metaName: {
    ...mobileType.title,
    fontSize: 16,
    lineHeight: 20,
  },
  metaViewersRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  metaViewers: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
  },
  metaLiveDot: {
    backgroundColor: mobileColors.live,
    borderRadius: mobileRadii.full,
    height: 6,
    width: 6,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 36,
    width: 36,
  },
  followButton: {
    alignItems: "center",
    backgroundColor: mobileColors.twitch,
    borderRadius: mobileRadii.full,
    height: 36,
    justifyContent: "center",
    minWidth: 56,
    paddingHorizontal: mobileSpacing.medium,
  },
  followButtonActive: {
    backgroundColor: mobileColors.surfaceRaised,
  },
  followButtonPressed: {
    opacity: 0.9,
  },
  followButtonBusy: {
    opacity: 0.6,
  },
});
