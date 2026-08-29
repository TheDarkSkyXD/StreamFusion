import { discoveryPageChunkLoaders } from "@/features/discovery";
import {
  mediaLibraryPrimaryPageChunkLoaders,
  historyPageChunkLoaders,
} from "@/features/media-library";
import { moderationPageChunkLoaders } from "@/features/moderation";
import { multistreamPageChunkLoaders } from "@/features/multistream";
import { playbackPageChunkLoaders } from "@/features/playback";
import { settingsPageChunkLoaders } from "@/features/settings";

type PageChunkLoader = () => Promise<unknown>;

interface StagedChunkPreloaderOptions {
  initialFrames: number;
  batchSize: number;
}

export function createStagedChunkPreloader(
  loaders: PageChunkLoader[],
  requestFrame: typeof requestAnimationFrame,
  { initialFrames, batchSize }: StagedChunkPreloaderOptions
): () => void {
  let scheduled = false;

  return () => {
    if (scheduled) return;
    scheduled = true;

    let framesRemaining = initialFrames;
    let nextLoaderIndex = 0;
    const advance = () => {
      if (framesRemaining > 0) {
        framesRemaining -= 1;
        requestFrame(advance);
        return;
      }

      const batch = loaders.slice(nextLoaderIndex, nextLoaderIndex + batchSize);
      nextLoaderIndex += batch.length;
      const pendingBatch = batch.map((load) => {
        try {
          return load();
        } catch (error) {
          return Promise.reject(error);
        }
      });
      void Promise.allSettled(pendingBatch).then(() => {
        if (nextLoaderIndex < loaders.length) requestFrame(advance);
      });
    };

    requestFrame(advance);
  };
}

const primaryPageChunkLoaders = [
  ...discoveryPageChunkLoaders,
  ...playbackPageChunkLoaders,
  ...settingsPageChunkLoaders,
  ...multistreamPageChunkLoaders,
  ...mediaLibraryPrimaryPageChunkLoaders,
  ...moderationPageChunkLoaders,
];

let primaryPageChunkScheduler: (() => void) | undefined;

export function schedulePrimaryPageChunkPreload(): void {
  primaryPageChunkScheduler ??= createStagedChunkPreloader(
    primaryPageChunkLoaders,
    window.requestAnimationFrame,
    { initialFrames: 2, batchSize: 3 }
  );
  primaryPageChunkScheduler();
}

let historyPageChunkScheduler: (() => void) | undefined;

export function scheduleHistoryPageChunkPreload(): void {
  historyPageChunkScheduler ??= createStagedChunkPreloader(
    historyPageChunkLoaders,
    window.requestAnimationFrame,
    { initialFrames: 1, batchSize: 1 }
  );
  historyPageChunkScheduler();
}
