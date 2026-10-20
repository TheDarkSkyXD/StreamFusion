import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import { watchTargetFromHistory } from "@mobile/features/media-library/domain/watch-history";

import type { FocusedWatchSession, WatchTarget } from "../capabilities/watch";
import { recordedWatchStartPositionMs } from "../domain/watch-target";

export async function startWatchThenResume(input: {
  readonly session: FocusedWatchSession;
  readonly target: WatchTarget;
  readonly history?: WatchHistoryRepository;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const { session, target, history, signal } = input;
  let startTarget = target;
  if (target.media && history) {
    const items = await history.list().catch(() => []);
    const match = items.find(
      (item) =>
        item.platform === target.platform &&
        item.kind === target.media?.kind &&
        item.contentId === target.media.id,
    );
    if (match) {
      const resumed = watchTargetFromHistory(match, "resume");
      startTarget = {
        ...target,
        media: {
          ...target.media,
          resumePositionSeconds: resumed.media?.resumePositionSeconds ?? 0,
        },
      };
    }
  }
  if (signal?.aborted) return;
  const result = await session.start(startTarget);
  if (result.kind !== "started") return;
  if (signal?.aborted) {
    await session.leave(startTarget);
    return;
  }
  const seekMs = recordedWatchStartPositionMs(startTarget);
  if (seekMs !== null) await session.seekTo(seekMs);
}
