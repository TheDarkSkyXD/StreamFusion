import { useEffect, useState } from "react";
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
import type { AdBlockView } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type {
  FocusedWatchSession,
  WatchPeek,
  WatchTab,
  WatchTarget,
} from "../capabilities/watch";
import {
  useFocusedWatchSession,
  useWatchPeek,
} from "./use-focused-watch-session";
import { WatchEmptyState, WatchScreen, type WatchMediaJobControls, type WatchScreenRuntime } from "./watch-screen";
import { recordedWatchStartPositionMs } from "../domain/watch-target";
import {
  watchDownloadEligibility,
  type WatchDownloadEligibility,
} from "../domain/watch-download";
import {
  watchRecordingEligibility,
  type WatchRecordingEligibility,
} from "../domain/watch-recording";

const chat = {
  detail: "Chat is not connected in this build. Watching continues.",
  kind: "not-connected" as const,
};

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

export function WatchRoute({
  download,
  recording,
  onAddToMultistream,
  onOpenRelated,
  screen,
  target,
}: {
  readonly download?: WatchDownloadSession;
  readonly recording?: WatchDownloadSession;
  readonly onAddToMultistream?: (target: WatchTarget) => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget | null;
}) {
  const peek = useWatchPeek(screen.runtime.session);
  const resolved =
    target ?? (peek.kind === "active" ? peek.state.target : null);
  if (!resolved) return <WatchEmptyState />;
  return (
    <WatchSessionRoute
      onOpenRelated={onOpenRelated}
      screen={screen}
      target={resolved}
      {...(download === undefined ? {} : { download })}
      {...(recording === undefined ? {} : { recording })}
      {...(onAddToMultistream === undefined ? {} : { onAddToMultistream })}
    />
  );
}

function WatchSessionRoute({
  download,
  recording,
  onAddToMultistream,
  onOpenRelated,
  screen,
  target,
}: {
  readonly download?: WatchDownloadSession;
  readonly recording?: WatchDownloadSession;
  readonly onAddToMultistream?: (target: WatchTarget) => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget;
}) {
  const [tab, setTab] = useState<WatchTab>("info");
  const [adblockView, setAdblockView] = useState<AdBlockView | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const session = screen.runtime.session;
  const playback = useFocusedWatchSession(session, target);
  const peek = useWatchPeek(session);
  const eligibility = watchDownloadEligibility(target);
  const recordingEligibility = watchRecordingEligibility(target);
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
  return (
    <WatchScreen
      PlayerSurface={screen.PlayerSurface}
      adblockView={adblockView}
      chat={chat}
      inspection={inspection.data ?? null}
      onMute={() => {
        if (peek.kind === "active") void session.setMuted(!peek.muted);
      }}
      onOpenProviderPage={() => {
        void screen.openProviderPage.open(target);
      }}
      onOpenRelated={onOpenRelated}
      onPip={() => {
        void session.requestPictureInPicture();
      }}
      onPlayPause={() => {
        if (peek.kind === "active") {
          void session.setPlaying(peek.state.phase === "paused");
        }
      }}
      onQuality={() => cycleWatchQuality(session, peek)}
      onRetry={() => {
        void session.start(target);
      }}
      onSeekBack={() => seekWatchSession(session, peek, -10_000)}
      onSeekForward={() => seekWatchSession(session, peek, 10_000)}
      onSelectTab={setTab}
      onStart={() => {
        void startWatchThenResume(session, target);
      }}
      onToggleFullscreen={() => {
        if (peek.kind === "active" && peek.presentation.presentation === "fullscreen") {
          session.exitFullscreen();
          return;
        }
        session.enterFullscreen();
      }}
      peek={peek}
      playback={playback}
      tab={tab}
      target={target}
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
                  "Download cancelled.",
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
                  "Recording cancelled.",
                );
              },
              recordingError,
            ),
          })}
      {...(onAddToMultistream === undefined || target.media
        ? {}
        : { onAddToMultistream: () => onAddToMultistream(target) })}
    />
  );
}

function cycleWatchQuality(
  session: FocusedWatchSession,
  peek: WatchPeek,
): void {
  if (peek.kind !== "active") return;
  const index = peek.qualities.indexOf(peek.quality);
  const next = peek.qualities[(index + 1) % peek.qualities.length] ?? "auto";
  void session.setQuality(next);
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
