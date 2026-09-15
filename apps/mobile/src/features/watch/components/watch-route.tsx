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
import { WatchEmptyState, WatchScreen, type WatchScreenRuntime } from "./watch-screen";
import { recordedWatchStartPositionMs } from "../domain/watch-target";
import { watchDownloadEligibility } from "../domain/watch-download";

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
  onAddToMultistream,
  onOpenRelated,
  screen,
  target,
}: {
  readonly download?: WatchDownloadSession;
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
      {...(onAddToMultistream === undefined ? {} : { onAddToMultistream })}
    />
  );
}

function WatchSessionRoute({
  download,
  onAddToMultistream,
  onOpenRelated,
  screen,
  target,
}: {
  readonly download?: WatchDownloadSession;
  readonly onAddToMultistream?: (target: WatchTarget) => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget;
}) {
  const [tab, setTab] = useState<WatchTab>("info");
  const [adblockView, setAdblockView] = useState<AdBlockView | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const session = screen.runtime.session;
  const playback = useFocusedWatchSession(session, target);
  const peek = useWatchPeek(session);
  const eligibility = watchDownloadEligibility(target);
  const downloadJob =
    eligibility.kind === "eligible"
      ? (download?.jobs.find((job) => job.intent.jobId === eligibility.jobId) ??
        null)
      : null;
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
            download: {
              busy: download.busy,
              eligibility,
              job: downloadJob,
              onCommand: download.onCommand,
              onDelete: download.onDelete,
              onExport: download.onExport,
              onOpenArtifact: download.onOpenArtifact,
              onStart: () => {
                void startWatchDownload(screen, target, download, setDownloadError);
              },
              status: downloadError ?? download.status,
            },
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

async function startWatchDownload(
  screen: WatchScreenRuntime,
  target: WatchTarget,
  download: WatchDownloadSession,
  setDownloadError: (reason: string | null) => void,
): Promise<void> {
  const eligibility = watchDownloadEligibility(target);
  if (eligibility.kind !== "eligible") {
    if (eligibility.kind === "unsupported") setDownloadError(eligibility.reason);
    return;
  }
  const resolved = await screen.runtime.resolveSource(
    target,
    new AbortController().signal,
  );
  if (resolved.kind !== "resolved") {
    setDownloadError(
      resolved.failure.kind === "cancelled"
        ? "Download cancelled."
        : resolved.failure.detail,
    );
    return;
  }
  setDownloadError(null);
  await download.onStartIntent(
    {
      schemaVersion: 1,
      jobId: eligibility.jobId,
      kind: "download",
      sourceUri: resolved.sourceUri,
      createdAt: toSerializedTimestamp(new Date().toISOString()),
    },
    resolved.requestHeaders,
  );
}
