import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";
import type { Stream } from "@streamfusion/core/content";
import type {
  MediaJobCommandName,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import type { AdBlockSession, AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import { WatchAdBlockStatus } from "@mobile/features/ad-blocking/components/watch-adblock-status";

import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
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
  readonly chat: WatchChatSession;
  readonly history: WatchHistoryRepository;
  readonly openProviderPage: {
    open(target: WatchTarget): Promise<unknown>;
  };
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
  captions,
  chat,
  chrome,
  download,
  recording,
  inspection,
  onChatRetry,
  onOpenChannel,
  onOpenProviderPage,
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
  readonly onChatRetry?: () => void;
  readonly onCloseQualityMenu?: () => void;
  readonly onOpenChannel?: () => void;
  readonly onOpenProviderPage: () => void;
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
  return (
    <View
      style={[styles.screen, pipSurface ? styles.pipScreen : null]}
      testID="screen-watch"
    >
      {pipSurface ? null : (
        <Pressable
          accessibilityHint={t("playback.watch.openChannelHint")}
          accessibilityLabel={t("playback.watch.openChannel", {
            name: displayName,
          })}
          accessibilityRole="button"
          disabled={onOpenChannel === undefined}
          onPress={onOpenChannel}
          style={({ pressed }) => [
            styles.meta,
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
            <View style={styles.avatar} testID="watch-channel-avatar-placeholder" />
          )}
          <View style={styles.metaCopy}>
            <Text selectable style={styles.metaName} testID="watch-target">
              {displayName}
            </Text>
            {viewerLine(inspection) ? (
              <Text selectable style={styles.metaViewers} testID="watch-meta-viewers">
                {viewerLine(inspection)}
              </Text>
            ) : (
              <MobilePlatformBadge platform={target.platform} />
            )}
          </View>
        </Pressable>
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
          {showsProvider(playback) ? (
            <MobileButton
              accessibilityLabel={t("playback.watch.openProviderPage")}
              onPress={onOpenProviderPage}
              testID="watch-open-provider"
              variant={target.platform}
            >
              {t("playback.watch.openProviderPage")}
            </MobileButton>
          ) : null}
          {tab === "info" ? (
            <View style={styles.toolsRow} testID="watch-tools">
              {adblockView === undefined ? null : (
                <WatchAdBlockStatus
                  compact
                  platform={target.platform}
                  view={adblockView}
                />
              )}
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


function viewerLine(inspection: WatchInspection | null): string | null {
  const info = inspection?.info;
  if (!info || info.kind !== "live") return null;
  return `${info.stream.viewerCount}`;
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

function showsProvider(playback: FocusedWatchState): boolean {
  if (playback.kind === "ended") return true;
  if (playback.kind !== "failed") return false;
  return playback.failure.recovery.includes("open-provider");
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
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  metaPressed: {
    opacity: 0.85,
  },
  metaCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  metaName: {
    ...mobileType.title,
    fontSize: 16,
    lineHeight: 20,
  },
  metaViewers: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 36,
    width: 36,
  },
});
