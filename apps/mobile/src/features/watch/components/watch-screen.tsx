import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentType } from "react";
import type { Stream } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
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
import { PlayerControls } from "./player-controls";
import { WatchTabs } from "./watch-tabs";

export type PlayerSurfaceProps = {
  readonly sessionId: string;
  readonly testID?: string;
};

export type WatchScreenRuntime = {
  readonly openProviderPage: {
    open(target: WatchTarget): Promise<unknown>;
  };
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly runtime: WatchRuntime;
};

export function WatchScreen({
  PlayerSurface,
  chat,
  inspection,
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
  tab,
  target,
}: {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly chat: WatchChatAvailability;
  readonly inspection: WatchInspection | null;
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
            <Text selectable style={styles.title}>
              {view.title}
            </Text>
            <Text selectable style={styles.body}>
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
      </View>
      {pipSurface ? null : (
        <>
          <Text selectable style={styles.meta} testID="watch-target">
            {`${target.platform.toUpperCase()} · ${target.channelName}`}
          </Text>
          {view.primaryAction === "start" ? (
            <Action label="Start watching" onPress={onStart} testID="watch-start" />
          ) : null}
          {view.primaryAction === "retry" ? (
            <Action label="Retry" onPress={onRetry} testID="watch-retry" />
          ) : null}
          {showsProvider(playback) ? (
            <Action
              label="Open provider page"
              onPress={onOpenProviderPage}
              testID="watch-open-provider"
            />
          ) : null}
          <WatchTabs
            chat={chat}
            info={inspection?.info ?? null}
            onOpenRelated={onOpenRelated}
            onSelect={onSelectTab}
            recorded={Boolean(target.media)}
            related={inspection?.related ?? null}
            tab={tab}
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

function Action({
  label,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.action}
      testID={testID}
    >
      <Text selectable style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

export function WatchEmptyState() {
  return (
    <View style={styles.screen} testID="screen-watch">
      <Text selectable style={styles.title}>
        Watch
      </Text>
      <Text selectable style={styles.body}>
        Select a live stream or recording to watch.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
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
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  body: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  meta: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  action: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
});
