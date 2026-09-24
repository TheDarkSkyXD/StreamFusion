import { useCallback, useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Stream } from "@streamfusion/core/content";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import type {
  MediaJobCommandName,
  MediaJobIntent,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";

import { useWatchHistoryCapture } from "@mobile/features/media-library/components/use-watch-history-capture";
import type { TwitchPlaylistProxyView } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { ProductPreferences } from "@streamfusion/core/settings";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import type {
  FocusedWatchSession,
  WatchPeek,
  WatchTab,
  WatchTarget,
} from "../capabilities/watch";
import { useWatchChat } from "@mobile/features/chat/components/use-watch-chat";
import { useChannelFollow } from "@mobile/features/discovery/components/use-channel-follow";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import {
  useFocusedWatchSession,
  useWatchPeek,
} from "./use-focused-watch-session";
import { WatchEmptyState, WatchScreen, type WatchCaptionControls, type WatchMediaJobControls, type WatchScreenRuntime } from "./watch-screen";
import { recordedWatchStartPositionMs } from "../domain/watch-target";
import {
  watchDownloadEligibility,
  type WatchDownloadEligibility,
} from "../domain/watch-download";
import {
  watchRecordingEligibility,
  type WatchRecordingEligibility,
} from "../domain/watch-recording";
import {
  watchCaptionEligibility,
  type WatchCaptionEligibility,
} from "../domain/watch-captions";
import type {
  CaptionModelState,
  CaptionSessionState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import { i18n } from "@mobile/i18n";

export type WatchDownloadSession = {
  readonly busy: boolean;
  readonly jobs: readonly MediaJobSnapshot[];
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onOpenArtifact: () => void;
  readonly onStartIntent: (
    intent: MediaJobIntent,
    requestHeaders?: Readonly<Record<string, string>>,
  ) => Promise<void>;
  readonly status: string | null;
};

export type WatchCaptionSession = {
  readonly busy: boolean;
  readonly cueText: string;
  readonly model: CaptionModelState | null;
  readonly onInstall: () => void;
  readonly onRemove: () => void;
  readonly onStart: (sessionId: string) => void;
  readonly onStop: (sessionId: string) => void;
  readonly session: CaptionSessionState | null;
  readonly status: string | null;
};


const INERT_FOLLOWING_SESSION = {
  listMembership: async () => [],
  mutateFollow: async () => ({ kind: "rejected" as const, reason: "invalid" as const }),
  resolveChannel: async () => null,
  hydrateLive: async () => ({ kick: { kind: "empty" }, twitch: { kind: "empty" } }),
  hydrateRecorded: async () => ({ kind: "empty" }),
  readNotifications: async () => ({} as never),
  writeNotifications: async () => ({} as never),
  openProviderPage: async () => {},
} as unknown as FollowingSession;

export function WatchRoute({
  captions,
  download,
  recording,
  discovery,
  following,
  onBack,
  onOpenChannel,
  onOpenRelated,
  onOpenSearch,
  playerPrefs,
  screen,
  target,
}: {
  readonly captions?: WatchCaptionSession;
  readonly download?: WatchDownloadSession;
  readonly recording?: WatchDownloadSession;
  readonly discovery?: {
    readonly onOpenAccounts: () => void;
    readonly session: DiscoverySession;
  };
  readonly following?: FollowingSession;
  readonly onBack?: () => void;
  readonly onOpenChannel?: (target: WatchTarget) => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onOpenSearch?: () => void;
  readonly playerPrefs?: ProductPreferences;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget | null;
}) {
  const peek = useWatchPeek(screen.runtime.session);
  const resolved =
    target ?? (peek.kind === "active" ? peek.state.target : null);
  if (!resolved) {
    return (
      <WatchEmptyState
        {...(discovery === undefined
          ? {}
          : {
              discovery: {
                onOpenAccounts: discovery.onOpenAccounts,
                onSelectStream: onOpenRelated,
                session: discovery.session,
              },
            })}
        {...(onOpenSearch === undefined ? {} : { onOpenSearch })}
      />
    );
  }
  return (
    <WatchSessionRoute
      onOpenRelated={onOpenRelated}
      screen={screen}
      target={resolved}
      {...(captions === undefined ? {} : { captions })}
      {...(download === undefined ? {} : { download })}
      {...(following === undefined ? {} : { following })}
      {...(recording === undefined ? {} : { recording })}
      {...(onBack === undefined ? {} : { onBack })}
      {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
      {...(playerPrefs === undefined ? {} : { playerPrefs })}
    />
  );
}

function WatchSessionRoute({
  captions,
  download,
  recording,
  following,
  onBack,
  onOpenChannel,
  onOpenRelated,
  playerPrefs,
  screen,
  target,
}: {
  readonly captions?: WatchCaptionSession;
  readonly download?: WatchDownloadSession;
  readonly recording?: WatchDownloadSession;
  readonly following?: FollowingSession;
  readonly onBack?: () => void;
  readonly onOpenChannel?: (target: WatchTarget) => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly playerPrefs?: ProductPreferences;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget;
}) {
  const tabTargetKey = `${target.platform}:${target.channelId}:${target.media?.kind ?? "live"}:${target.media?.id ?? ""}`;
  const defaultTab: WatchTab = target.media ? "comments" : "chat";
  const [tab, setTab] = useState<WatchTab>(defaultTab);
  const [tabTarget, setTabTarget] = useState(tabTargetKey);
  if (tabTarget !== tabTargetKey) {
    setTabTarget(tabTargetKey);
    setTab(target.media ? "comments" : "chat");
  }
  const [adblockView, setAdblockView] = useState<AdBlockView | null>(null);
  const [playlistProxyView, setPlaylistProxyView] =
    useState<TwitchPlaylistProxyView | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [idleToken, setIdleToken] = useState(0);
  const session = screen.runtime.session;
  const chat = useWatchChat(screen.chat, target);
  const channelFollow = useChannelFollow({
    channel: {
      id: target.channelId,
      platform: target.platform,
      username: target.channelName,
    },
    displayName: target.channelName,
    enabled: following !== undefined,
    following: following ?? INERT_FOLLOWING_SESSION,
  });
  const playback = useFocusedWatchSession(session, target);
  const peek = useWatchPeek(session);
  useEffect(() => {
    if (playback.kind !== "ready") return;
    void startWatchThenResume(session, target);
  }, [playback.kind, session, target]);
  const eligibility = watchDownloadEligibility(target);
  const recordingEligibility = watchRecordingEligibility(target);
  const captionEligibility = watchCaptionEligibility(
    target,
    playerPrefs?.captionsEnabled ?? true,
  );
  const rewindMs = (playerPrefs?.rewindSeconds ?? 10) * 1_000;
  const forwardMs = (playerPrefs?.fastForwardSeconds ?? 10) * 1_000;
  const downloadJob = jobForEligibility(download?.jobs, eligibility);
  const recordingJob = jobForEligibility(recording?.jobs, recordingEligibility);
  const inspection = useQuery({
    queryFn: ({ signal }) => screen.runtime.inspection.read({ signal, target }),
    queryKey: [
      "watch-inspection",
      target.platform,
      target.channelId,
      target.channelName,
      target.media?.kind ?? "live",
      target.media?.id ?? "",
    ],
  });
  useEffect(() => {
    void screen.adblock?.load().then(setAdblockView);
  }, [screen.adblock]);
  useEffect(() => {
    void screen.playlistProxy?.load().then(setPlaylistProxyView);
  }, [screen.playlistProxy]);
  useWatchHistoryCapture({
    inspection: inspection.data ?? null,
    peek,
    repository: screen.history,
    target,
  });
  useEffect(() => {
    if (peek.kind !== "active" || peek.presentation.presentation !== "fullscreen") {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      session.exitFullscreen();
      return true;
    });
    return () => subscription.remove();
  }, [peek, session]);
  const playing =
    peek.kind === "active" && peek.state.phase !== "paused";
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    setIdleToken((token) => token + 1);
  }, []);
  const controlsForcedVisible = !playing || qualityMenuOpen;
  useEffect(() => {
    if (controlsForcedVisible) {
      return undefined;
    }
    const timer = setTimeout(() => setControlsVisible(false), 3_000);
    return () => clearTimeout(timer);
  }, [controlsForcedVisible, idleToken]);
  const showControls = controlsForcedVisible || controlsVisible;
  return (
    <WatchScreen
      PlayerSurface={screen.PlayerSurface}
      adblockView={adblockView}
      playlistProxyActive={playlistProxyView?.enabled === true}
      chat={chat}
      followBusy={channelFollow.follow.kind === "pending"}
      followed={channelFollow.follow.kind === "guest-present"}
      inspection={inspection.data ?? null}
      onChatRetry={() => screen.chat.retry()}
      controlsVisible={showControls}
      onCloseQualityMenu={() => setQualityMenuOpen(false)}
      {...(onBack === undefined ? {} : { onBack })}
      {...(following === undefined
        ? {}
        : { onFollow: () => channelFollow.toggle() })}
      onMute={() => {
        revealControls();
        if (peek.kind === "active") void session.setMuted(!peek.muted);
      }}
      {...(onOpenChannel === undefined
        ? {}
        : { onOpenChannel: () => onOpenChannel(target) })}
      onPlayerTap={() => {
        setTab("info");
      }}
      onOpenRelated={onOpenRelated}
      onPip={() => {
        revealControls();
        void session.requestPictureInPicture();
      }}
      onPlayPause={() => {
        revealControls();
        if (peek.kind === "active") {
          void session.setPlaying(peek.state.phase === "paused");
        }
      }}
      onQualityPress={() => {
        revealControls();
        setQualityMenuOpen(true);
      }}
      onRetry={() => {
        void session.start(target);
      }}
      onSeekBack={() => {
        revealControls();
        seekWatchSession(session, peek, -rewindMs);
      }}
      onSeekForward={() => {
        revealControls();
        seekWatchSession(session, peek, forwardMs);
      }}
      onSeekTo={(positionMs) => {
        revealControls();
        seekWatchSessionTo(session, peek, positionMs);
      }}
      onSelectQuality={(nextQuality) => {
        if (peek.kind === "active") void session.setQuality(nextQuality);
      }}
      onSelectTab={setTab}
      onToggleControls={() => {
        setControlsVisible((current) => !current);
        setIdleToken((token) => token + 1);
      }}
      onToggleFullscreen={() => {
        revealControls();
        if (peek.kind === "active" && peek.presentation.presentation === "fullscreen") {
          session.exitFullscreen();
          return;
        }
        session.enterFullscreen();
      }}
      peek={peek}
      playback={playback}
      qualityMenuOpen={qualityMenuOpen}
      tab={tab}
      target={target}
      {...(playerPrefs === undefined
        ? {}
        : {
            chrome: {
              showFullscreen: playerPrefs.showFullscreen,
              showQuality: playerPrefs.showQuality,
              showVolume: playerPrefs.showVolume,
            },
            fastForwardSeconds: playerPrefs.fastForwardSeconds,
            rewindSeconds: playerPrefs.rewindSeconds,
          })}
      {...(download === undefined
        ? {}
        : {
            download: mediaJobControls(
              download,
              eligibility,
              downloadJob,
              () => {
                void startWatchMediaJob(
                  screen,
                  target,
                  download,
                  setDownloadError,
                  eligibility,
                  "download",
                  i18n.t("playback.watch.downloadCancelled"),
                );
              },
              downloadError,
            ),
          })}
      {...(recording === undefined
        ? {}
        : {
            recording: mediaJobControls(
              recording,
              recordingEligibility,
              recordingJob,
              () => {
                void startWatchMediaJob(
                  screen,
                  target,
                  recording,
                  setRecordingError,
                  recordingEligibility,
                  "recording",
                  i18n.t("playback.watch.recordingCancelled"),
                );
              },
              recordingError,
            ),
          })}
      {...(captions === undefined || captionEligibility.kind === "hidden"
        ? {}
        : {
            captions: captionControls(captions, captionEligibility),
          })}
    />
  );
}



function seekWatchSessionTo(
  session: FocusedWatchSession,
  peek: WatchPeek,
  positionMs: number,
): void {
  if (peek.kind !== "active" || !peek.progress.seekable) return;
  const duration = peek.progress.durationMs;
  const clamped =
    duration > 0
      ? Math.min(duration, Math.max(0, positionMs))
      : Math.max(0, positionMs);
  void session.seekTo(clamped);
}

function seekWatchSession(
  session: FocusedWatchSession,
  peek: WatchPeek,
  deltaMs: number,
): void {
  if (peek.kind !== "active" || !peek.progress.seekable) return;
  const next = peek.progress.positionMs + deltaMs;
  if (deltaMs < 0) {
    void session.seekTo(Math.max(0, next));
    return;
  }
  const duration = peek.progress.durationMs;
  void session.seekTo(duration > 0 ? Math.min(duration, next) : next);
}

async function startWatchThenResume(
  session: FocusedWatchSession,
  target: WatchTarget,
): Promise<void> {
  const result = await session.start(target);
  if (result.kind !== "started") return;
  const seekMs = recordedWatchStartPositionMs(target);
  if (seekMs === null) return;
  await session.seekTo(seekMs);
}

function jobForEligibility(
  jobs: readonly MediaJobSnapshot[] | undefined,
  eligibility: WatchDownloadEligibility | WatchRecordingEligibility,
): MediaJobSnapshot | null {
  if (eligibility.kind !== "eligible" || jobs === undefined) return null;
  return jobs.find((job) => job.intent.jobId === eligibility.jobId) ?? null;
}

function captionControls(
  session: WatchCaptionSession,
  eligibility: WatchCaptionEligibility,
): WatchCaptionControls {
  return {
    busy: session.busy,
    cueText: session.cueText,
    eligibility,
    model: session.model,
    onInstall: session.onInstall,
    onRemove: session.onRemove,
    onStart: () => {
      if (eligibility.kind === "eligible") session.onStart(eligibility.sessionId);
    },
    onStop: () => {
      session.onStop(
        eligibility.kind === "eligible"
          ? eligibility.sessionId
          : (session.session?.sessionId ?? "idle"),
      );
    },
    session: session.session,
    status: session.status,
  };
}

function mediaJobControls<Eligibility>(
  session: WatchDownloadSession,
  eligibility: Eligibility,
  job: MediaJobSnapshot | null,
  onStart: () => void,
  error: string | null,
): WatchMediaJobControls<Eligibility> {
  return {
    busy: session.busy,
    eligibility,
    job,
    onCommand: session.onCommand,
    onDelete: session.onDelete,
    onExport: session.onExport,
    onOpenArtifact: session.onOpenArtifact,
    onStart,
    status: error ?? session.status,
  };
}

async function startWatchMediaJob(
  screen: WatchScreenRuntime,
  target: WatchTarget,
  session: WatchDownloadSession,
  setError: (reason: string | null) => void,
  eligibility: WatchDownloadEligibility | WatchRecordingEligibility,
  kind: MediaJobIntent["kind"],
  cancelledMessage: string,
): Promise<void> {
  if (eligibility.kind !== "eligible") {
    if (eligibility.kind === "unsupported") setError(eligibility.reason);
    return;
  }
  const resolved = await screen.runtime.resolveSource(
    target,
    new AbortController().signal,
  );
  if (resolved.kind !== "resolved") {
    setError(
      resolved.failure.kind === "cancelled"
        ? cancelledMessage
        : resolved.failure.detail,
    );
    return;
  }
  setError(null);
  await session.onStartIntent(
    {
      schemaVersion: 1,
      jobId: eligibility.jobId,
      kind,
      sourceUri: resolved.sourceUri,
      createdAt: toSerializedTimestamp(new Date().toISOString()),
    },
    resolved.requestHeaders,
  );
}
