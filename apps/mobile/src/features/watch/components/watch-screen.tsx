import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";
import type { Stream } from "@streamfusion/core/content";
import type {
  MediaJobCommandName,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import type { AdBlockSession, AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import { WatchAdBlockStatus } from "@mobile/features/ad-blocking/components/watch-adblock-status";

import { MobileButton } from "@mobile/design/button";
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
import { composeWatchView } from "../domain/watch-view";
import { isPictureInPictureSurface } from "../domain/player-presentation";
import type { WatchDownloadEligibility } from "../domain/watch-download";
import type { WatchRecordingEligibility } from "../domain/watch-recording";
import { PlayerControls } from "./player-controls";
import { WatchCaptionBar, type WatchCaptionBarProps } from "./watch-caption-bar";
import { WatchCaptionOverlay } from "./watch-caption-overlay";
import { WatchDownloadBar } from "./watch-download-bar";
import { WatchRecordingBar } from "./watch-recording-bar";
import { WatchRecentList } from "./watch-recent-list";
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
  onAddToMultistream,
  onChatRetry,
  onOpenProviderPage,
  onOpenRelated,
  onRetry,
  onSelectTab,
  onStart,
  onMute,
  onPip,
  onPlayPause,
  onQuality,
  onSeekBack,
  onSeekForward,
  onToggleFullscreen,
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
  readonly download?: WatchMediaJobControls<WatchDownloadEligibility>;
  readonly recording?: WatchMediaJobControls<WatchRecordingEligibility>;
  readonly inspection: WatchInspection | null;
  readonly onAddToMultistream?: () => void;
  readonly onChatRetry?: () => void;
  readonly onOpenProviderPage: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onRetry: () => void;
  readonly onSelectTab: (tab: WatchTab) => void;
  readonly onStart: () => void;
  readonly onMute?: () => void;
  readonly onPip?: () => void;
  readonly onPlayPause?: () => void;
  readonly onQuality?: () => void;
  readonly onSeekBack?: () => void;
  readonly onSeekForward?: () => void;
  readonly onToggleFullscreen?: () => void;
  readonly peek?: WatchPeek;
  readonly playback: FocusedWatchState;
  readonly rewindSeconds?: number;
  readonly fastForwardSeconds?: number;
  readonly tab: WatchTab;
  readonly target: WatchTarget;
}) {
  const view = composeWatchView(playback);
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
    onQuality &&
    onToggleFullscreen;
  return (
    <View
      style={[styles.screen, pipSurface ? styles.pipScreen : null]}
      testID="screen-watch"
    >
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
              {view.title}
            </Text>
            <Text selectable style={mobileType.body}>
              {view.detail}
            </Text>
          </View>
        )}
        {showControls && peek.kind === "active" ? (
          <PlayerControls
            fullscreen={fullscreen}
            muted={peek.muted}
            onFullscreen={onToggleFullscreen}
            onMute={onMute}
            onPip={onPip}
            onPlayPause={onPlayPause}
            onQuality={onQuality}
            {...(chrome === undefined ? {} : { chrome })}
            {...(fastForwardSeconds === undefined ? {} : { fastForwardSeconds })}
            {...(rewindSeconds === undefined ? {} : { rewindSeconds })}
            {...(onSeekBack === undefined ? {} : { onSeekBack })}
            {...(onSeekForward === undefined ? {} : { onSeekForward })}
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
          <View style={styles.meta} testID="watch-target">
            <MobilePlatformBadge platform={target.platform} />
            <Text selectable style={mobileType.title}>
              {target.channelName}
            </Text>
          </View>
          {adblockView === undefined ? null : (
            <WatchAdBlockStatus platform={target.platform} view={adblockView} />
          )}
          {view.primaryAction === "start" ? (
            <MobileButton
              accessibilityLabel="Start watching"
              onPress={onStart}
              testID="watch-start"
              variant="primary"
            >
              Start watching
            </MobileButton>
          ) : null}
          {view.primaryAction === "retry" ? (
            <MobileButton
              accessibilityLabel="Retry"
              onPress={onRetry}
              testID="watch-retry"
              variant="primary"
            >
              Retry
            </MobileButton>
          ) : null}
          {download ? <WatchDownloadBar {...download} /> : null}
          {recording ? <WatchRecordingBar {...recording} /> : null}
          {captions ? <WatchCaptionBar {...captions} /> : null}
          {showsProvider(playback) ? (
            <MobileButton
              accessibilityLabel="Open provider page"
              onPress={onOpenProviderPage}
              testID="watch-open-provider"
              variant={target.platform}
            >
              Open provider page
            </MobileButton>
          ) : null}
          <WatchTabs
            chat={chat}
            info={inspection?.info ?? null}
            onOpenRelated={onOpenRelated}
            onSelect={onSelectTab}
            recorded={Boolean(target.media)}
            related={inspection?.related ?? null}
            tab={tab}
            {...(onAddToMultistream === undefined
              ? {}
              : { onAddToMultistream })}
            {...(onChatRetry === undefined ? {} : { onChatRetry })}
          />
        </>
      )}
    </View>
  );
}

function showsProvider(playback: FocusedWatchState): boolean {
  if (playback.kind === "ended") return true;
  if (playback.kind !== "failed") return false;
  return playback.failure.recovery.includes("open-provider");
}

export function WatchEmptyState({
  history,
  onOpenSearch,
  onWatch,
}: {
  readonly history?: WatchHistoryRepository;
  readonly onOpenSearch?: () => void;
  readonly onWatch?: (target: WatchTarget) => void;
} = {}) {
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="screen-watch"
    >
      <MobileScreenHeader title="Watch" />
      <MobileStatusPanel testID="watch-empty" tone="empty">
        <Text selectable style={mobileType.title}>
          Nothing playing
        </Text>
        <Text selectable style={mobileType.body}>
          Pick a live stream or recording from Search or Following to watch here.
        </Text>
      </MobileStatusPanel>
      {history && onWatch ? (
        <WatchRecentList
          history={history}
          onWatch={onWatch}
          {...(onOpenSearch === undefined ? {} : { onOpenSearch })}
        />
      ) : onOpenSearch ? (
        <MobileButton
          accessibilityHint="Opens Search to find something to watch"
          accessibilityLabel="Find something in Search"
          onPress={onOpenSearch}
          testID="watch-empty-open-search"
          variant="secondary"
        >
          Find something in Search
        </MobileButton>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  screen: {
    flex: 1,
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
  },
  pipScreen: {
    gap: 0,
    padding: 0,
  },
  playerStage: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.background,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
    width: "100%",
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
    gap: mobileSpacing.small,
  },
});
