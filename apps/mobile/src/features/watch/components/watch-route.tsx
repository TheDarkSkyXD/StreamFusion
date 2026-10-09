import { useCallback, useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Stream } from "@streamfusion/core/content";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import type {
  MediaJobCommandName,
  MediaJobIntent,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";

import { mediaJobDisplay } from "@mobile/features/media-jobs/utils/media-display";
import type { DisplayMediaJobIntent } from "@mobile/features/media-jobs/capabilities/media-display";
import { useWatchHistoryCapture } from "@mobile/features/media-library/components/use-watch-history-capture";
import type { AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { ProductPreferences } from "@streamfusion/core/settings";
import { getDisplayLanguage } from "@streamfusion/core/display-language";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import type {
  FocusedWatchSession,
  WatchPeek,
  WatchTab,
  WatchTarget,
} from "../capabilities/watch";
import {
  CONNECTING_WATCH_CHAT_SNAPSHOT,
  useWatchChatConnection,
} from "@mobile/features/chat/components/use-watch-chat";
import { useChannelFollow } from "@mobile/features/discovery/components/use-channel-follow";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import {
  useFocusedWatchSession,
  useWatchPeek,
} from "./use-focused-watch-session";
import {
  WatchEmptyState,
  WatchScreen,
  type WatchCaptionControls,
  type WatchMediaJobControls,
  type WatchScreenRuntime,
  type WatchToolSheet,
} from "./watch-screen";
import { isPictureInPictureSurface } from "../domain/player-presentation";
import { watchDownloadCopyId } from "../domain/watch-download-copy";
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
import type { WatchChatMessage } from "@mobile/features/chat/capabilities/watch-chat";
import type { ChatEngagementInlineBindings } from "@mobile/features/engagement/components/chat-engagement-inline";

export type WatchDownloadSession = {
  readonly busy: boolean;
  readonly jobs: readonly MediaJobSnapshot[];
  readonly onCommand: (command: MediaJobCommandName, jobId?: string) => void;
  readonly onDelete: (jobId?: string) => void;
  readonly onExport: (jobId?: string) => void;
  readonly onOpenArtifact: (jobId?: string) => void;
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
  readonly onCancelInstall?: () => void;
  readonly onStart: (sessionId: string) => void;
  readonly onStop: (sessionId: string) => void;
  readonly session: CaptionSessionState | null;
  readonly status: string | null;
};

const INERT_FOLLOWING_SESSION: Pick<
  FollowingSession,
  "listMembership" | "mutateFollow"
> = {
  listMembership: async () => [],
  mutateFollow: async () => ({ kind: "rejected", reason: "invalid" }),
};

export function WatchRoute({
  inlineEngagement,
  onOpenEngagement,
  onModerateMessage,
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
  readonly inlineEngagement?: ChatEngagementInlineBindings;
  readonly onOpenEngagement?: () => void;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
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
                ...(playerPrefs === undefined
                  ? {}
                  : {
                      language: getDisplayLanguage(playerPrefs.language)
                        .streamLanguage,
                    }),
              },
            })}
        {...(onOpenSearch === undefined ? {} : { onOpenSearch })}
      />
    );
  }
  return (
    <WatchSessionRoute
      {...(inlineEngagement === undefined ? {} : { inlineEngagement })}
      {...(onOpenEngagement === undefined ? {} : { onOpenEngagement })}
      {...(onModerateMessage === undefined ? {} : { onModerateMessage })}
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
  inlineEngagement,
  onOpenEngagement,
  onModerateMessage,
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
  readonly inlineEngagement?: ChatEngagementInlineBindings;
  readonly onOpenEngagement?: () => void;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
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
  const [toolSheet, setToolSheet] = useState<WatchToolSheet>(null);
  if (tabTarget !== tabTargetKey) {
    setTabTarget(tabTargetKey);
    setTab(target.media ? "comments" : "chat");
    setToolSheet(null);
  }
  const [adblockView, setAdblockView] = useState<AdBlockView | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [idleToken, setIdleToken] = useState(0);
  const session = screen.runtime.session;
  useWatchChatConnection(screen.chat, target);
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
  const sessionId =
    peek.kind === "active" ? peek.state.session.sessionId : null;
  const pipSurface =
    peek.kind === "active" && isPictureInPictureSurface(peek.presentation);
  const [sheetSession, setSheetSession] = useState({ sessionId, pipSurface });
  if (
    sheetSession.sessionId !== sessionId ||
    sheetSession.pipSurface !== pipSurface
  ) {
    setSheetSession({ sessionId, pipSurface });
    setToolSheet(null);
  }
  useEffect(() => {
    if (playback.kind !== "ready") return;
    void startWatchThenResume(session, target);
  }, [playback.kind, session, target]);
  const lastCopyCommandTime = useRef(0);
  const eligibility = watchDownloadEligibility(target);
  const recordingEligibility = watchRecordingEligibility(target);
  const captionEligibility = watchCaptionEligibility(
    target,
    playerPrefs?.captionsEnabled ?? true,
    screen.nativePlayback && peek.kind === "active"
      ? peek.state.session.sessionId
      : undefined,
  );
  const rewindMs = (playerPrefs?.rewindSeconds ?? 10) * 1_000;
  const forwardMs = (playerPrefs?.fastForwardSeconds ?? 10) * 1_000;
  const downloadJob =
    download?.jobs.find(
      (job) =>
        mediaJobDisplay(job)?.sourceIdentity ===
          `${target.platform}:${target.media?.kind ?? "live"}:${target.media?.id ?? target.channelId}` &&
        job.intent.kind === "download",
    ) ?? jobForEligibility(download?.jobs, eligibility);
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
  useWatchHistoryCapture({
    inspection: inspection.data ?? null,
    peek,
    repository: screen.history,
    target,
  });
  const playing = peek.kind === "active" && peek.state.phase !== "paused";
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    setIdleToken((token) => token + 1);
  }, []);
  const selectToolSheet = useCallback(
    (next: WatchToolSheet) => {
      setToolSheet(next);
      revealControls();
    },
    [revealControls],
  );
  const controlsForcedVisible =
    !playing || qualityMenuOpen || toolSheet !== null;
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
      {...(inlineEngagement === undefined ? {} : { inlineEngagement })}
      chatSession={screen.chat}
      {...(screen.chatInteractions === undefined
        ? {}
        : { chatInteractions: screen.chatInteractions })}
      {...(onOpenEngagement === undefined ? {} : { onOpenEngagement })}
      {...(onModerateMessage === undefined ? {} : { onModerateMessage })}
      PlayerSurface={screen.PlayerSurface}
      playerTools={session}
      adblockView={adblockView}
      chat={CONNECTING_WATCH_CHAT_SNAPSHOT}
      followBusy={channelFollow.follow.kind === "pending"}
      followed={channelFollow.follow.kind === "guest-present"}
      inspection={inspection.data ?? null}
      onChatRetry={() => screen.chat.retry()}
      controlsVisible={showControls}
      toolSheet={{ active: toolSheet, onChange: selectToolSheet }}
      onCloseQualityMenu={() => setQualityMenuOpen(false)}
      {...(onBack === undefined ? {} : { onBack })}
      {...(following === undefined
        ? {}
        : { onFollow: () => channelFollow.toggle() })}
      onMute={() => {
        revealControls();
        if (peek.kind === "active") void session.setMuted(!peek.muted);
      }}
      onVolumeChange={(volume) => {
        revealControls();
        if (peek.kind === "active") {
          void session.setVolume(volume);
          if (volume > 0 && peek.muted) void session.setMuted(false);
        }
      }}
      {...(onOpenChannel === undefined
        ? {}
        : { onOpenChannel: () => onOpenChannel(target) })}
      onPlayerTap={() => {
        setTab("info");
      }}
      onOpenRelated={onOpenRelated}
      onPlayPause={() => {
        revealControls();
        if (peek.kind === "active") {
          void session.setPlaying(peek.state.phase === "paused");
        }
      }}
      onQualityPress={() => {
        revealControls();
        setQualityMenuOpen(true);
        if (peek.kind === "active") void session.setQuality(peek.quality);
      }}
      onRetry={() => {
        revealControls();
        void session.start(target);
      }}
      onRefresh={() => {
        revealControls();
        void session.refresh(target);
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
        if (
          peek.kind === "active" &&
          peek.presentation.presentation === "fullscreen"
        ) {
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
              showSpeed: playerPrefs.showSpeed,
              showVideoStats: playerPrefs.showVideoStats,
            },
            fastForwardSeconds: playerPrefs.fastForwardSeconds,
            rewindSeconds: playerPrefs.rewindSeconds,
          })}
      {...(download === undefined
        ? {}
        : {
            download: {
              ...mediaJobControls(
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
              onStartAgain: () => {
                if (eligibility.kind !== "eligible") return;
                const commandTime = Math.max(
                  Date.now(),
                  lastCopyCommandTime.current + 1,
                );
                lastCopyCommandTime.current = commandTime;
                const copy = {
                  ...eligibility,
                  jobId: watchDownloadCopyId(
                    eligibility.jobId,
                    commandTime,
                    download.jobs.map((job) => job.intent.jobId),
                  ),
                };
                void startWatchMediaJob(
                  screen,
                  target,
                  download,
                  setDownloadError,
                  copy,
                  "download",
                  i18n.t("playback.watch.downloadCancelled"),
                );
              },
            },
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
    ...(session.onCancelInstall
      ? { onCancelInstall: session.onCancelInstall }
      : {}),
    onStart: () => {
      if (eligibility.kind === "eligible")
        session.onStart(eligibility.sessionId);
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
    onCommand: (command) => session.onCommand(command, job?.intent.jobId),
    onDelete: () => session.onDelete(job?.intent.jobId),
    onExport: () => session.onExport(job?.intent.jobId),
    onOpenArtifact: () => session.onOpenArtifact(job?.intent.jobId),
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
  const intent: DisplayMediaJobIntent = {
    display: {
      title: target.media?.title ?? `${target.channelName} recording`,
      channelName: target.channelName,
      platform: target.platform,
      contentKind: target.media?.kind ?? "recording",
      sourceIdentity: `${target.platform}:${target.media?.kind ?? "live"}:${target.media?.id ?? target.channelId}`,
      thumbnailUrl: target.media?.thumbnailUrl ?? null,
    },
    schemaVersion: 1,
    jobId: eligibility.jobId,
    kind,
    sourceUri: resolved.sourceUri,
    createdAt: toSerializedTimestamp(new Date().toISOString()),
  };
  await session.onStartIntent(intent, resolved.requestHeaders);
}
