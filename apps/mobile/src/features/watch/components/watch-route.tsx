import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Stream } from "@streamfusion/core/content";

import type { WatchTab, WatchTarget } from "../capabilities/watch";
import { useFocusedWatchSession } from "./use-focused-watch-session";
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
  if (!target) return <WatchEmptyState />;
  return (
    <WatchSessionRoute
      onOpenRelated={onOpenRelated}
      screen={screen}
      target={target}
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
  const playback = useFocusedWatchSession(screen.runtime.session, target);
  const inspection = useQuery({
    queryFn: ({ signal }) => screen.runtime.inspection.read({ signal, target }),
    queryKey: ["watch-inspection", target.platform, target.channelId, target.channelName],
  });
  useEffect(
    () => () => {
      void screen.runtime.session.leave(target);
    },
    [screen.runtime.session, target],
  );
  return (
    <WatchScreen
      PlayerSurface={screen.PlayerSurface}
      chat={chat}
      inspection={inspection.data ?? null}
      onOpenProviderPage={() => {
        void screen.openProviderPage.open(target);
      }}
      onOpenRelated={onOpenRelated}
      onRetry={() => {
        void screen.runtime.session.start(target);
      }}
      onSelectTab={setTab}
      onStart={() => {
        void screen.runtime.session.start(target);
      }}
      playback={playback}
      tab={tab}
      target={target}
    />
  );
}
