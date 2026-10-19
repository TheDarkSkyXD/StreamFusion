import { useTranslation } from "react-i18next";
import {
  Captions,
  ChartNoAxesCombined,
  ChevronDown,
  Download,
  Gauge,
  SlidersHorizontal,
  Vote,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, type ComponentType } from "react";
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

import { MobileListRow } from "@mobile/design/list-row";
import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSelectSelectedIndicator,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type {
  WatchChatSession,
  WatchChatMessage,
} from "@mobile/features/chat/capabilities/watch-chat";
import type { ChatInteractions } from "@mobile/features/chat/capabilities/chat-interactions";
import type { ChatPresentation } from "@mobile/features/chat/capabilities/chat-presentation";
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
import { WatchOptionsScreen } from "./watch-options-screen";
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
  readonly chatPresentation?: ChatPresentation;
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
  readonly onStartAgain?: () => void;
  readonly status?: string | null;
};

export type WatchToolSheet =
  "settings" | "quality" | "captions" | "media" | "speed" | "stats" | null;

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
  chatPresentation,
  inlineEngagement,
  chrome,
  download,
  recording,
  inspection,
  onChatRetry,
  onModerateMessage,
  followBusy = false,
  followed = false,
  liveAlerts = true,
  notificationsBusy = false,
  onBack,
  onFollow,
  onOpenChannel,
  onOpenEngagement,
  onOpenRelated,
  onToggleLiveAlerts,
  onRefresh,
  onRetry,
  onSelectTab,
  onMute,
  onPlayPause,
  onSelectQuality,
  onSeekBack,
  onSeekForward,
  onSeekTo,
  onToggleFullscreen,
  onToggleControls,
  controlsVisible = true,
  notificationStatus,
  peek,
  playback,
  rewindSeconds,
  fastForwardSeconds,
  tab,
  target,
  toolSheet,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly playerTools?: Pick<
    FocusedWatchSession,
    "readPlaybackObservation" | "setPlaybackSpeed"
  >;
  readonly adblockView?: AdBlockView | null;
  readonly captions?: WatchCaptionControls;
  readonly chat: WatchChatAvailability;
  readonly chatSession?: WatchChatSession;
  readonly chatInteractions?: ChatInteractions;
  readonly chatPresentation?: ChatPresentation;
  readonly inlineEngagement?: ChatEngagementInlineBindings;
  readonly chrome?: {
    readonly showFullscreen: boolean;
    readonly showQuality: boolean;
    readonly showSpeed?: boolean;
    readonly showVideoStats?: boolean;
  };
  readonly controlsVisible?: boolean;
  readonly liveAlerts?: boolean;
  readonly notificationsBusy?: boolean;
  readonly notificationStatus?: string | null;
  readonly download?: WatchMediaJobControls<WatchDownloadEligibility>;
  readonly recording?: WatchMediaJobControls<WatchRecordingEligibility>;
  readonly inspection: WatchInspection | null;
  readonly followBusy?: boolean;
  readonly followed?: boolean;
  readonly onBack?: () => void;
  readonly onChatRetry?: () => void;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
  readonly onFollow?: () => void;
  readonly onOpenChannel?: () => void;
  readonly onOpenEngagement?: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onToggleLiveAlerts?: () => void;
  readonly onRefresh?: () => void;
  readonly onRetry: () => void;
  readonly onSelectQuality?: (quality: string) => void;
  readonly onSelectTab: (tab: WatchTab) => void;
  readonly onMute?: () => void;
  readonly onPlayPause?: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly onSeekTo?: (positionMs: number) => void;
  readonly onToggleControls?: () => void;
  readonly onToggleFullscreen?: () => void;
  readonly peek?: WatchPeek;
  readonly playback: FocusedWatchState;
  readonly rewindSeconds?: number;
  readonly fastForwardSeconds?: number;
  readonly tab: WatchTab;
  readonly target: WatchTarget;
  readonly toolSheet: WatchToolSheetControl;
}) {
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
  const isOptionsSubpage =
    toolSheet.active !== null && toolSheet.active !== "settings";
  const pipSurface =
    peek?.kind === "active" && isPictureInPictureSurface(peek.presentation);
  const showControls =
    peek?.kind === "active" &&
    !pipSurface &&
    onMute &&
    onPlayPause &&
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
        {onBack && !showControls && !fullscreen && !pipSurface ? (
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.stageBack}
            testID="watch-back"
          >
            <ChevronDown color={mobileColors.textPrimary} size={30} />
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
            liveMeta={
              inspection?.info.kind === "live"
                ? {
                    startedAt: inspection.info.stream.startedAt ?? null,
                    viewerCount: inspection.info.stream.viewerCount,
                  }
                : null
            }
            muted={peek.muted}
            {...(fullscreen
              ? { onBack: onToggleFullscreen }
              : onBack
                ? { onBack }
                : {})}
            onFullscreen={onToggleFullscreen}
            onMute={onMute}
            onPlayPause={onPlayPause}
            {...(onRefresh === undefined ? {} : { onRefresh })}
            onSettingsPress={() => toolSheet.onChange("settings")}
            onToggleVisible={onToggleControls}
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
            paused={peek.state.phase === "paused"}
            platform={target.platform}
            progress={peek.progress}
            seekable={peek.progress.seekable}
            volume={peek.volume}
          />
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
          {...(notificationStatus === undefined ? {} : { notificationStatus })}
          liveAlerts={liveAlerts}
          notificationsBusy={notificationsBusy}
          {...(onFollow === undefined ? {} : { onFollow })}
          {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
          {...(onToggleLiveAlerts === undefined ? {} : { onToggleLiveAlerts })}
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
            {...(chatPresentation === undefined ? {} : { chatPresentation })}
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
        <WatchOptionsScreen
          title={
            toolSheet.active === "quality"
              ? t("settings.quality")
              : toolSheet.active === "captions"
                ? "Local captions"
                : toolSheet.active === "media"
                  ? "Downloads and recordings"
                  : toolSheet.active === "speed"
                    ? "Playback speed"
                    : toolSheet.active === "stats"
                      ? "Video Stats"
                      : t("playback.watch.options")
          }
          visible={toolSheet.active !== null}
          backLabel={t(
            isOptionsSubpage
              ? "playback.watch.backToOptions"
              : "playback.watch.backToPlayer",
          )}
          backTestID={
            isOptionsSubpage ? "watch-sheet-back" : "watch-options-back"
          }
          onBack={() =>
            toolSheet.onChange(isOptionsSubpage ? "settings" : null)
          }
        >
          {toolSheet.active === "settings" ? (
            <View
              style={[styles.optionsList, styles.optionsRoot]}
              testID="watch-settings-menu"
            >
              {chrome?.showQuality !== false && peek?.kind === "active" ? (
                <MobileListRow
                  title={t("settings.quality")}
                  description={peek.quality}
                  leading={
                    <SlidersHorizontal
                      color={mobileColors.textSecondary}
                      size={22}
                    />
                  }
                  testID="watch-settings-quality"
                  onPress={() => toolSheet.onChange("quality")}
                />
              ) : null}
              <MobileListRow
                title={t("playback.captions")}
                leading={
                  <Captions color={mobileColors.textSecondary} size={22} />
                }
                disabled={!captions}
                testID="watch-settings-captions"
                onPress={() => toolSheet.onChange("captions")}
              />
              <MobileListRow
                title="Downloads and recordings"
                leading={
                  <Download color={mobileColors.textSecondary} size={22} />
                }
                disabled={!download && !recording}
                testID="watch-settings-media"
                onPress={() => toolSheet.onChange("media")}
              />
              {playerTools && target.media && chrome?.showSpeed !== false ? (
                <MobileListRow
                  title="Playback speed"
                  leading={
                    <Gauge color={mobileColors.textSecondary} size={22} />
                  }
                  testID="watch-settings-speed"
                  onPress={() => toolSheet.onChange("speed")}
                />
              ) : null}
              {playerTools && chrome?.showVideoStats !== false ? (
                <MobileListRow
                  title="Video Stats"
                  leading={
                    <ChartNoAxesCombined
                      color={mobileColors.textSecondary}
                      size={22}
                    />
                  }
                  testID="watch-settings-stats"
                  onPress={() => toolSheet.onChange("stats")}
                />
              ) : null}
              {!target.media && onOpenEngagement ? (
                <View style={styles.optionsDivider} />
              ) : null}
              {!target.media && onOpenEngagement ? (
                <MobileListRow
                  title="Polls and predictions"
                  leading={
                    <Vote color={mobileColors.textSecondary} size={22} />
                  }
                  testID="watch-engagement"
                  onPress={() => {
                    toolSheet.onChange(null);
                    onOpenEngagement();
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {toolSheet.active === "quality" && peek?.kind === "active" ? (
            <View
              accessibilityRole="radiogroup"
              style={styles.optionsList}
              testID="player-quality-menu"
            >
              {(peek.qualities.length ? peek.qualities : [peek.quality]).map(
                (option) => (
                  <Pressable
                    key={option}
                    accessibilityLabel={
                      option === "auto" ? t("playback.auto") : option
                    }
                    accessibilityRole="radio"
                    accessibilityState={{ checked: option === peek.quality }}
                    testID={`player-quality-option-${option}`}
                    style={({ pressed }) => [
                      styles.qualityOption,
                      option === peek.quality
                        ? styles.qualityOptionSelected
                        : null,
                      pressed ? styles.optionPressed : null,
                    ]}
                    onPress={() => {
                      onSelectQuality?.(option);
                      toolSheet.onChange(null);
                    }}
                  >
                    <Text style={styles.qualityOptionLabel}>
                      {option === "auto" ? t("playback.auto") : option}
                    </Text>
                    <View
                      accessible={false}
                      style={[
                        styles.qualityRadio,
                        option === peek.quality
                          ? styles.qualityRadioSelected
                          : null,
                      ]}
                    >
                      {option === peek.quality ? (
                        <View style={styles.qualityRadioDot} />
                      ) : null}
                    </View>
                  </Pressable>
                ),
              )}
            </View>
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
          {(toolSheet.active === "speed" || toolSheet.active === "stats") &&
          playerTools &&
          peek?.kind === "active" ? (
            <PlayerTools
              session={playerTools}
              tool={toolSheet.active}
              sessionId={peek.state.session.sessionId}
            />
          ) : null}
        </WatchOptionsScreen>
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
  optionsList: { gap: mobileSpacing.xSmall },
  optionsRoot: { marginHorizontal: -mobileSpacing.medium },
  optionsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: mobileColors.border,
    marginHorizontal: mobileSpacing.medium,
    marginVertical: mobileSpacing.small,
  },
  qualityOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: mobileSpacing.medium,
    minHeight: 56,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
    borderRadius: mobileRadii.medium,
  },
  qualityOptionSelected: { backgroundColor: mobileColors.surfaceMuted },
  qualityOptionLabel: {
    ...mobileType.body,
    color: mobileColors.textPrimary,
    flex: 1,
  },
  qualityRadio: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: mobileRadii.full,
    borderColor: mobileColors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  qualityRadioSelected: { borderColor: mobileSelectSelectedIndicator.color },
  qualityRadioDot: {
    width: mobileSelectSelectedIndicator.diameter,
    height: mobileSelectSelectedIndicator.diameter,
    borderRadius: mobileRadii.full,
    backgroundColor: mobileSelectSelectedIndicator.color,
  },
  optionPressed: { backgroundColor: mobileColors.surfaceRaised },
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
