import { useEffect } from "react";

import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import { logger } from "@/renderer/logging/logger";

import type { Platform } from "../../shared/auth-types";
import { useAfterFirstPaint } from "../useAfterFirstPaint";

const RECENT_STREAM_PREWARM_KEY = "recent-stream-prewarm:v1";
const RECENT_STREAM_LIMIT = 4;
const IMAGES_PER_STREAM_LIMIT = 8;

interface RecentStreamPrewarmEntry {
  platform: Platform;
  channelName: string;
  imageUrls: string[];
  updatedAt: number;
}

interface RecentStreamPrewarmIndex {
  version: 1;
  entries: RecentStreamPrewarmEntry[];
}

let updateChain: Promise<void> = Promise.resolve();

function validIndex(value: unknown): RecentStreamPrewarmIndex {
  if (!value || typeof value !== "object") return { version: 1, entries: [] };
  const candidate = value as Partial<RecentStreamPrewarmIndex>;
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) {
    return { version: 1, entries: [] };
  }
  return { version: 1, entries: candidate.entries };
}

export function rememberRecentStreamImages(
  platform: Platform,
  channelName: string,
  imageUrls: Array<string | null | undefined>
): Promise<void> {
  const normalizedChannel = channelName.trim().toLowerCase();
  const uniqueUrls = [...new Set(imageUrls.filter((url): url is string => Boolean(url)))].slice(
    0,
    IMAGES_PER_STREAM_LIMIT
  );
  if (!normalizedChannel || uniqueUrls.length === 0) return Promise.resolve();

  updateChain = updateChain
    .catch(() => undefined)
    .then(async () => {
      try {
        const stored = validIndex(
          await window.electronAPI.store.get<RecentStreamPrewarmIndex>(RECENT_STREAM_PREWARM_KEY)
        );
        const entry: RecentStreamPrewarmEntry = {
          platform,
          channelName: normalizedChannel,
          imageUrls: uniqueUrls,
          updatedAt: Date.now(),
        };
        const entries = [
          entry,
          ...stored.entries.filter(
            (item) => item.platform !== platform || item.channelName !== normalizedChannel
          ),
        ].slice(0, RECENT_STREAM_LIMIT);
        await window.electronAPI.store.set(RECENT_STREAM_PREWARM_KEY, { version: 1, entries });
      } catch (error) {
        logger.warn("Stream:Prewarm", "failed to remember recent stream images", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  return updateChain;
}

export async function prewarmRecentStreamImages(): Promise<void> {
  const stored = validIndex(
    await window.electronAPI.store.get<RecentStreamPrewarmIndex>(RECENT_STREAM_PREWARM_KEY)
  );
  await prewarmViewportImages(stored.entries.flatMap((entry) => entry.imageUrls));
}

export function useRecentStreamImagePrewarm(): void {
  const canPrewarm = useAfterFirstPaint();
  useEffect(() => {
    if (!canPrewarm) return;
    void prewarmRecentStreamImages().catch((error) => {
      logger.warn("Stream:Prewarm", "failed to prewarm recent stream images", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [canPrewarm]);
}

export function resetRecentStreamPrewarmForTests(): void {
  updateChain = Promise.resolve();
}
