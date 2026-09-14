import { useEffect, useRef } from "react";

import type {
  WatchInspection,
  WatchPeek,
  WatchTarget,
} from "@mobile/features/watch/capabilities/watch";
import type { WatchHistoryRepository } from "../capabilities/watch-history";
import {
  shouldPersistWatchProgress,
  watchHistoryItemFromCapture,
} from "../domain/watch-history";

export function useWatchHistoryCapture(input: {
  readonly inspection: WatchInspection | null;
  readonly peek: WatchPeek;
  readonly repository: WatchHistoryRepository | null;
  readonly target: WatchTarget;
}): void {
  const lastPositionRef = useRef(0);
  const writtenRef = useRef(false);

  useEffect(() => {
    lastPositionRef.current = 0;
    writtenRef.current = false;
  }, [input.target.channelId, input.target.media?.id, input.target.platform]);

  useEffect(() => {
    const repository = input.repository;
    if (!repository || input.peek.kind !== "active") return;
    const positionSeconds = Math.floor(input.peek.progress.positionMs / 1000);
    const item = watchHistoryItemFromCapture({
      inspection: input.inspection,
      positionSeconds,
      target: input.target,
      updatedAt: Date.now(),
    });
    if (!item) return;
    const firstWrite = !writtenRef.current;
    if (
      !firstWrite &&
      !shouldPersistWatchProgress({
        next: positionSeconds,
        previous: lastPositionRef.current,
      })
    ) {
      return;
    }
    writtenRef.current = true;
    lastPositionRef.current = positionSeconds;
    void repository.upsert(item);
  }, [input.inspection, input.peek, input.repository, input.target]);
}
