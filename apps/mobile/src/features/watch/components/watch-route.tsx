import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Stream } from "@streamfusion/core/content";

import type { WatchTab, WatchTarget } from "../capabilities/watch";
import {
  useFocusedWatchSession,
  useWatchPeek,
} from "./use-focused-watch-session";
import { WatchEmptyState, WatchScreen, type WatchScreenRuntime } from "./watch-screen";

const chat = {
  detail: "Chat is not connected in this build. Watching continues.",
  kind: "not-connected" as const,
};

export function WatchRoute({
  onOpenRelated,
  screen,
  target,
}: {
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
    />
  );
}

function WatchSessionRoute({
  onOpenRelated,
  screen,
  target,
}: {
  readonly onOpenRelated: (stream: Stream) => void;
  readonly screen: WatchScreenRuntime;
  readonly target: WatchTarget;
}) {
  const [tab, setTab] = useState<WatchTab>("info");
  const session = screen.runtime.session;
  const playback = useFocusedWatchSession(session, target);
  const peek = useWatchPeek(session);
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
    if (peek.kind !== "active" || peek.presentation.presentation !== "fullscreen") {
      return undefined;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      session.exitFullscreen();
      return true;
    });
    return () => subscription.remove();
  }, [peek, session]);
  const qualityOptions =
    peek.kind === "active" ? peek.qualities : (["auto"] as const);
  const seek = (deltaMs: number) => {
    if (peek.kind !== "active" || !peek.progress.seekable) return;
    const next = peek.progress.positionMs + deltaMs;
    if (deltaMs < 0) {
      void session.seekTo(Math.max(0, next));
      return;
    }
    const duration = peek.progress.durationMs;
    void session.seekTo(duration > 0 ? Math.min(duration, next) : next);
  };
  return (
    <WatchScreen
      PlayerSurface={screen.PlayerSurface}
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
      onQuality={() => {
        if (peek.kind !== "active") return;
        const index = qualityOptions.indexOf(peek.quality);
        const next = qualityOptions[(index + 1) % qualityOptions.length] ?? "auto";
        void session.setQuality(next);
      }}
      onRetry={() => {
        void session.start(target);
      }}
      onSeekBack={() => seek(-10_000)}
      onSeekForward={() => seek(10_000)}
      onSelectTab={setTab}
      onStart={() => {
        void session.start(target);
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
    />
  );
}
