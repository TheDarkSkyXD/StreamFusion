import { useTranslation } from "react-i18next";
import { ArrowLeft, Captions, Download, Ellipsis } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, type ComponentType } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Stream } from "@streamfusion/core/content";
import type {
  MediaJobCommandName,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import type {
  AdBlockSession,
  AdBlockView,
} from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxySession } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";

import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type {
  WatchChatSession,
  WatchChatMessage,
} from "@mobile/features/chat/capabilities/watch-chat";
import type { ChatInteractions } from "@mobile/features/chat/capabilities/chat-interactions";
import type {
  FocusedWatchState,
  FocusedWatchSession,
  WatchChatAvailability,
  WatchInspection,
  WatchPeek,
  WatchRuntime,
  WatchTab,
  WatchTarget,
} from "../capabilities/watch";
import { composeWatchView, resolveWatchCopy } from "../domain/watch-view";
import { watchAdBlockStatus } from "../domain/adblock-playback-status";
import { isPictureInPictureSurface } from "../domain/player-presentation";
import type { WatchDownloadEligibility } from "../domain/watch-download";
import type { WatchRecordingEligibility } from "../domain/watch-recording";
import { PlayerTools } from "./player-tools";
import { PlayerControls } from "./player-controls";
import {
  WatchCaptionBar,
  type WatchCaptionBarProps,
} from "./watch-caption-bar";
import { WatchCaptionOverlay } from "./watch-caption-overlay";
import { WatchDownloadBar } from "./watch-download-bar";
import { WatchRecordingBar } from "./watch-recording-bar";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import { HomeLiveDiscoveryScreen } from "@mobile/features/discovery/components/home-live-discovery-screen";
import { WatchTabs } from "./watch-tabs";
import { WatchChannelCard } from "./watch-channel-card";
import type { WatchSubscriptionPageOpener } from "../capabilities/watch-subscription-page";
import type { ChatEngagementInlineBindings } from "@mobile/features/engagement/components/chat-engagement-inline";

export type PlayerSurfaceProps = {
  readonly sessionId: string;
  readonly testID?: string;
};

export type WatchScreenRuntime = {
  readonly nativePlayback?: boolean;
  readonly adblock?: AdBlockSession;
  readonly playlistProxy?: TwitchPlaylistProxySession;
  readonly chat: WatchChatSession;
  readonly chatInteractions?: ChatInteractions;
  readonly history: WatchHistoryRepository;
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly runtime: WatchRuntime;
  readonly subscriptionPage?: WatchSubscriptionPageOpener;
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
  readonly onStartAgain?: () => void;
  readonly status?: string | null;
};

export type WatchToolSheet =
  "captions" | "media" | "more" | "speed" | "stats" | null;

export type WatchToolSheetControl = {
  readonly active: WatchToolSheet;
  readonly onChange: (next: WatchToolSheet) => void;
};

export function WatchScreen({
  PlayerSurface,
  playerTools,
  adblockView,
  captions,
  chat,
  chatSession,
  chatInteractions,
  inlineEngagement,
  chrome,
  download,
  recording,
  inspection,
  onChatRetry,
  onModerateMessage,
  followBusy = false,
  followed = false,
  onBack,
  onFollow,
  onOpenChannel,
  onOpenEngagement,
  onOpenRelated,
  onSubscribe,
  onRefresh,
  onRetry,
  onSelectTab,
  onMute,
  onVolumeChange,
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
  subscriptionStatus,
  qualityMenuOpen = false,
  peek,
  playback,
  rewindSeconds,
  fastForwardSeconds,
  tab,
  target,
  toolSheet,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly playerTools?: FocusedWatchSession;
  readonly adblockView?: AdBlockView | null;
  readonly captions?: WatchCaptionControls;
  readonly chat: WatchChatAvailability;
  readonly chatSession?: WatchChatSession;
  readonly chatInteractions?: ChatInteractions;
  readonly inlineEngagement?: ChatEngagementInlineBindings;
  readonly chrome?: {
    readonly showFullscreen: boolean;
    readonly showQuality: boolean;
    readonly showVolume: boolean;
    readonly showSpeed?: boolean;
    readonly showVideoStats?: boolean;
  };
  readonly controlsVisible?: boolean;
  readonly subscriptionStatus?: string | null;
  readonly download?: WatchMediaJobControls<WatchDownloadEligibility>;
  readonly recording?: WatchMediaJobControls<WatchRecordingEligibility>;
  readonly inspection: WatchInspection | null;
  readonly followBusy?: boolean;
  readonly followed?: boolean;
  readonly onBack?: () => void;
  readonly onChatRetry?: () => void;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
  readonly onCloseQualityMenu?: () => void;
  readonly onFollow?: () => void;
  readonly onOpenChannel?: () => void;
  readonly onOpenEngagement?: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onSubscribe?: () => void;
  readonly onRefresh?: () => void;
  readonly onRetry: () => void;
  readonly onSelectQuality?: (quality: string) => void;
  readonly onSelectTab: (tab: WatchTab) => void;
  readonly onMute?: () => void;
  readonly onVolumeChange?: (volume: number) => void;
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
  readonly toolSheet: WatchToolSheetControl;
}) {
  const insets = useSafeAreaInsets();
  const positionMs = peek?.kind === "active" ? peek.progress.positionMs : null;
  useEffect(() => {
    if (positionMs !== null) chatSession?.syncPlayback?.(positionMs);
  }, [chatSession, positionMs]);
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  const view = composeWatchView(playback);
  const captionSession =
    captions?.session?.sessionId === view.sessionId ? captions.session : null;
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
    onPlayPause &&
    onQualityPress &&
    onToggleFullscreen &&
    onToggleControls;
  return (
    <View
      style={[styles.screen, pipSurface ? styles.pipScreen : null]}
      testID="screen-watch"
    >
      <View
        key="player-stage"
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
        {onBack && !fullscreen && !pipSurface ? (
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.stageBack}
            testID="watch-back"
          >
            <ArrowLeft color={mobileColors.textPrimary} size={22} />
          </Pressable>
        ) : null}
        {!showControls && onToggleControls && !pipSurface ? (
          <Pressable
            accessibilityLabel={t("playback.watch.showControls")}
            accessibilityRole="button"
            onPress={onToggleControls}
            style={StyleSheet.absoluteFill}
            testID="watch-player-tap"
          />
        ) : null}
        {showControls && peek.kind === "active" ? (
          <PlayerControls
            adBlockStatus={watchAdBlockStatus({
              adsDetected: peek.adsDetected,
              filteringActive: adblockFilteringActive(adblockView, target),
            })}
            fullscreen={fullscreen}
            live={!target.media}
            muted={peek.muted}
            {...(target.media || onRefresh === undefined ? {} : { onRefresh })}
            onFullscreen={onToggleFullscreen}
            onMute={onMute}
            {...(onVolumeChange === undefined ? {} : { onVolumeChange })}
            onPlayPause={onPlayPause}
            onQualityPress={onQualityPress}
            onToggleVisible={onToggleControls}
            qualities={peek.qualities}
            qualityMenuOpen={qualityMenuOpen}
            visible={controlsVisible}
            {...(chrome === undefined ? {} : { chrome })}
            {...(fastForwardSeconds === undefined
              ? {}
              : { fastForwardSeconds })}
            {...(rewindSeconds === undefined ? {} : { rewindSeconds })}
            {...(onSeekBack === undefined ? {} : { onSeekBack })}
            {...(onSeekForward === undefined ? {} : { onSeekForward })}
            {...(onSeekTo === undefined
              ? {}
              : {
                  onSeekTo: (position: number) => {
                    chatSession?.seekPlayback?.(position);
                    onSeekTo(position);
                  },
                })}
            {...(onSelectQuality === undefined ? {} : { onSelectQuality })}
            {...(onCloseQualityMenu === undefined
              ? {}
              : { onCloseQualityMenu })}
            paused={peek.state.phase === "paused"}
            platform={target.platform}
            progress={peek.progress}
            quality={peek.quality}
            seekable={peek.progress.seekable}
            volume={peek.volume}
          />
        ) : null}
        {showControls && controlsVisible ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.stageTools,
              fullscreen
                ? {
                    top: Math.max(insets.top, mobileSpacing.small),
                    right: Math.max(insets.right, mobileSpacing.small),
                  }
                : null,
            ]}
            testID="watch-tools"
          >
            <MobileIconButton
              label={t("playback.captions")}
              testID="watch-tool-captions"
              disabled={!captions}
              onPress={() => toolSheet.onChange("captions")}
            >
              <Captions color={mobileColors.textPrimary} size={22} />
            </MobileIconButton>
            <MobileIconButton
              label={
                target.media ? t("playback.download") : t("mediaLibrary.record")
              }
              testID="watch-tool-media"
              disabled={!download && !recording}
              onPress={() => toolSheet.onChange("media")}
            >
              <Download color={mobileColors.textPrimary} size={22} />
            </MobileIconButton>
            <MobileIconButton
              label={t("navigation.more")}
              testID="watch-tool-more"
              onPress={() => toolSheet.onChange("more")}
            >
              <Ellipsis color={mobileColors.textPrimary} size={22} />
            </MobileIconButton>
          </View>
        ) : null}
        {pipSurface ? null : (
          <WatchCaptionOverlay
            text={
              captionSession?.state === "active"
                ? (captions?.cueText ?? "")
                : ""
            }
          />
        )}
      </View>
      {pipSurface || fullscreen ? null : (
        <WatchChannelCard
          info={inspection?.info ?? null}
          target={target}
          expanded={controlsVisible}
          followed={followed}
          followBusy={followBusy}
          {...(subscriptionStatus === undefined ? {} : { subscriptionStatus })}
          {...(onFollow === undefined ? {} : { onFollow })}
          {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
          {...(onSubscribe === undefined ? {} : { onSubscribe })}
        />
      )}
      {pipSurface || fullscreen ? null : (
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
          <WatchTabs
            chat={chat}
            {...(inlineEngagement === undefined ? {} : { inlineEngagement })}
            {...(chatSession === undefined ? {} : { chatSession })}
            chatTarget={target}
            {...(chatInteractions === undefined ? {} : { chatInteractions })}
            info={inspection?.info ?? null}
            onOpenRelated={onOpenRelated}
            onSelect={onSelectTab}
            platform={target.platform}
            recorded={Boolean(target.media)}
            related={inspection?.related ?? null}
            tab={tab}
            {...(onChatRetry === undefined ? {} : { onChatRetry })}
            {...(onModerateMessage === undefined ? {} : { onModerateMessage })}
          />
        </>
      )}
      {pipSurface ? null : (
        <MobileBottomSheet
          title={
            toolSheet.active === "captions"
              ? "Local captions"
              : toolSheet.active === "media"
                ? "Downloads and recordings"
                : toolSheet.active === "speed"
                  ? "Playback speed"
                  : toolSheet.active === "stats"
                    ? "Video Stats"
                    : "Player tools"
          }
          visible={toolSheet.active !== null}
          testID="watch-tools-sheet"
          onDismiss={() => toolSheet.onChange(null)}
          size="expanded"
        >
          {toolSheet.active === "more" && !target.media && onOpenEngagement ? (
            <MobileButton
              accessibilityLabel="Polls and predictions"
              onPress={() => {
                toolSheet.onChange(null);
                onOpenEngagement();
              }}
              testID="watch-engagement"
              variant="secondary"
            >
              Polls and predictions
            </MobileButton>
          ) : null}
          {toolSheet.active === "captions" && captions ? (
            <WatchCaptionBar {...captions} session={captionSession} />
          ) : null}
          {toolSheet.active === "media" ? (
            <>
              {download ? <WatchDownloadBar {...download} /> : null}
              {recording ? <WatchRecordingBar {...recording} /> : null}
            </>
          ) : null}
          {(toolSheet.active === "more" ||
            toolSheet.active === "speed" ||
            toolSheet.active === "stats") &&
          playerTools &&
          peek?.kind === "active" ? (
            <PlayerTools
              session={playerTools}
              tool={toolSheet.active === "more" ? "menu" : toolSheet.active}
              onSelectTool={toolSheet.onChange}
              sessionId={peek.state.session.sessionId}
              recorded={
                target.media !== undefined && chrome?.showSpeed !== false
              }
              showStats={chrome?.showVideoStats !== false}
            />
          ) : null}
        </MobileBottomSheet>
      )}
    </View>
  );
}

function adblockFilteringActive(
  view: AdBlockView | null | undefined,
  target: WatchTarget,
): boolean {
  if (!view || target.platform !== "twitch" || target.media) return false;
  return view.enabled && view.policyAllowed && view.method === "strip";
}

export function WatchEmptyState({
  discovery,
  onOpenSearch,
}: {
  readonly discovery?: {
    readonly onOpenAccounts: () => void;
    readonly onSelectStream: (stream: Stream) => void;
    readonly language?: string;
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
          {...(discovery.language === undefined
            ? {}
            : { language: discovery.language })}
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
  stageTools: {
    position: "absolute",
    top: mobileSpacing.small,
    right: mobileSpacing.small,
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    backgroundColor: "rgba(15, 15, 15, 0.76)",
    borderRadius: mobileRadii.medium,
    zIndex: 2,
  },
  stageBack: {
    position: "absolute",
    left: mobileSpacing.small,
    top: mobileSpacing.small,
    zIndex: 3,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 15, 15, 0.76)",
    borderRadius: mobileRadii.full,
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
});
