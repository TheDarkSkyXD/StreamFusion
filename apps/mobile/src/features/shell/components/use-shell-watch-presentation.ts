import { useEffect } from "react";

import type { FocusedWatchSession } from "@mobile/features/watch/capabilities/watch";
import { useWatchPeek } from "@mobile/features/watch/components/use-focused-watch-session";
import { isPictureInPictureSurface } from "@mobile/features/watch/domain/player-presentation";

export function useShellWatchPresentation(
  session: FocusedWatchSession,
  watchingWatch: boolean,
) {
  const peek = useWatchPeek(session);
  const pictureInPictureSurface =
    peek.kind === "active" && isPictureInPictureSurface(peek.presentation);
  const activeSessionId =
    peek.kind === "active" ? peek.state.session.sessionId : null;

  useEffect(() => {
    if (watchingWatch || pictureInPictureSurface) {
      session.reveal();
      return;
    }
    session.conceal();
  }, [activeSessionId, pictureInPictureSurface, watchingWatch, session]);

  return peek;
}
