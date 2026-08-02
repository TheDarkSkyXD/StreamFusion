import type { ClipDownloadRequest, DownloadProgress } from "@/shared/download-types";
import {
  decodeTwitchClipMediaUrl,
  TWITCH_CLIP_MEDIA_SCHEME,
} from "../protocols/twitch-clip-media-url";
import { DownloadCancelledError } from "./direct-file-download-service";
import type { DownloadQueueService } from "./download-queue-service";
import type { FfmpegProgress } from "./ffmpeg-download-service";

export interface ClipPlaybackQuality {
  quality: string;
  url: string;
}

export interface ClipPlaybackResult {
  url: string;
  format: string;
  durationSeconds?: number | null;
  qualities?: ClipPlaybackQuality[];
}

export interface DirectDownloadInput {
  url: string;
  destinationPath: string;
  signal: AbortSignal;
  onProgress: (progress: DownloadProgress) => void;
}

export interface HlsDownloadInput {
  ffmpegPath: string;
  inputUrl: string;
  destinationPath: string;
  durationSeconds?: number | null;
  signal: AbortSignal;
  onProgress: (progress: FfmpegProgress) => void;
}

export { DownloadCancelledError } from "./direct-file-download-service";

export interface ClipDownloadService {
  downloadClip(request: ClipDownloadRequest): Promise<{
    success: boolean;
    jobId?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  retryClip(jobId: string): Promise<{
    success: boolean;
    jobId?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  cancel(jobId: string): boolean;
}

export function unwrapClipDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${TWITCH_CLIP_MEDIA_SCHEME}:`) return url;
    const encoded = parsed.searchParams.get("u");
    const decoded = encoded ? decodeTwitchClipMediaUrl(encoded) : null;
    return decoded ?? url;
  } catch {
    return url;
  }
}

function isExpiredSignedUrlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /status 40[13]|expired|signature/i.test(message);
}

function isSourceRemovedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /deleted|gone|not found|removed|source removed|no longer playable/i.test(message);
}

function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function selectMatchingQuality(
  playback: ClipPlaybackResult,
  previousQuality: ClipPlaybackQuality | null
): ClipPlaybackQuality | null {
  if (!previousQuality) return playback.qualities?.[0] ?? null;
  return (
    playback.qualities?.find((quality) => quality.quality === previousQuality.quality) ??
    playback.qualities?.[0] ??
    null
  );
}

export function createClipDownloadService({
  queue,
  resolvePlayback,
  chooseQuality,
  chooseSavePath,
  getAvailablePath,
  downloadFile,
  resolveFfmpegPath,
  downloadHls,
  now = () => new Date().toISOString(),
}: {
  queue: DownloadQueueService;
  resolvePlayback: (request: ClipDownloadRequest) => Promise<ClipPlaybackResult>;
  chooseQuality: (qualities: ClipPlaybackQuality[]) => Promise<ClipPlaybackQuality | null>;
  chooseSavePath: (request: ClipDownloadRequest, extension: string) => Promise<string | null>;
  getAvailablePath: (path: string) => string;
  downloadFile: (input: DirectDownloadInput) => Promise<void>;
  resolveFfmpegPath?: () => string;
  downloadHls?: (
    input: HlsDownloadInput
  ) => Promise<{ outputPath: string; format: "mp4" | "ts"; outputBytes?: number }>;
  now?: () => string;
}): ClipDownloadService {
  const activeControllers = new Map<string, AbortController>();

  async function downloadPlayback({
    jobId,
    playback,
    destinationPath,
    durationSeconds,
    selectedQuality,
    signal,
  }: {
    jobId: string;
    playback: ClipPlaybackResult;
    destinationPath: string;
    durationSeconds: number | null;
    selectedQuality: ClipPlaybackQuality | null;
    signal: AbortSignal;
  }) {
    const url = unwrapClipDownloadUrl(selectedQuality?.url ?? playback.url);
    if (playback.format === "mp4") {
      await downloadFile({
        url,
        destinationPath,
        signal,
        onProgress: (progress) => {
          queue.updateProgress(jobId, progress);
        },
      });
      queue.updateTarget(jobId, { outputFormat: "mp4" });
      return;
    }

    if (playback.format === "hls" && resolveFfmpegPath && downloadHls) {
      const result = await downloadHls({
        ffmpegPath: resolveFfmpegPath(),
        inputUrl: url,
        destinationPath,
        durationSeconds,
        signal,
        onProgress: (progress) => {
          queue.updateProgress(jobId, {
            percent: progress.percent,
            transferredBytes: progress.outputBytes ?? 0,
            totalBytes: null,
          });
        },
      });
      if (typeof result.outputBytes === "number") {
        queue.updateProgress(jobId, {
          percent: 100,
          transferredBytes: result.outputBytes,
          totalBytes: result.outputBytes,
        });
      }
      queue.updateTarget(jobId, {
        destinationPath: result.outputPath,
        outputFormat: result.format,
      });
      return;
    }

    throw new Error("Only direct MP4 or HLS clip downloads are supported");
  }

  async function runDownload({
    jobId,
    playback,
    destinationPath,
    durationSeconds,
    selectedQuality,
    refreshPlayback,
    refreshed = false,
  }: {
    jobId: string;
    playback: ClipPlaybackResult;
    destinationPath: string;
    durationSeconds: number | null;
    selectedQuality: ClipPlaybackQuality | null;
    refreshPlayback?: () => Promise<ClipPlaybackResult>;
    refreshed?: boolean;
  }) {
    const controller = new AbortController();
    activeControllers.set(jobId, controller);
    queue.start(jobId);

    try {
      await downloadPlayback({
        jobId,
        playback,
        destinationPath,
        durationSeconds,
        signal: controller.signal,
        selectedQuality,
      });

      queue.complete(jobId);
      return { success: true, jobId };
    } catch (error) {
      if (controller.signal.aborted || error instanceof DownloadCancelledError) {
        queue.cancel(jobId);
        const message = error instanceof Error ? error.message : "Download cancelled";
        return { success: false, jobId, cancelled: true, error: message };
      }
      if (!refreshed && refreshPlayback && isExpiredSignedUrlError(error)) {
        const nextPlayback = await refreshPlayback();
        if (
          controller.signal.aborted ||
          queue.getQueue().jobs.find((candidate) => candidate.id === jobId)?.status === "cancelled"
        ) {
          queue.cancel(jobId);
          return {
            success: false,
            jobId,
            cancelled: true,
            error: "Download cancelled",
          };
        }
        const nextQuality = selectMatchingQuality(nextPlayback, selectedQuality);
        return runDownload({
          jobId,
          playback: nextPlayback,
          destinationPath,
          durationSeconds: nextPlayback.durationSeconds ?? durationSeconds,
          selectedQuality: nextQuality,
          refreshPlayback,
          refreshed: true,
        });
      }
      const message = error instanceof Error ? error.message : "Clip download failed";
      queue.updateTarget(jobId, { partial: true, retryable: true });
      queue.fail(jobId, message);
      return { success: false, jobId, error: message };
    } finally {
      if (activeControllers.get(jobId) === controller) {
        activeControllers.delete(jobId);
      }
    }
  }

  return {
    async downloadClip(request) {
      try {
        const playback = await resolvePlayback(request);
        if (playback.format !== "mp4" && playback.format !== "hls")
          throw new Error("Unsupported clip format");

        const selectedQuality =
          playback.qualities && playback.qualities.length > 1
            ? await chooseQuality(playback.qualities)
            : (playback.qualities?.[0] ?? null);
        if (playback.qualities && playback.qualities.length > 1 && !selectedQuality) {
          return { success: false, cancelled: true, error: "Quality selection cancelled" };
        }

        const chosenPath = await chooseSavePath(request, ".mp4");
        if (!chosenPath) {
          return { success: false, cancelled: true, error: "Save cancelled" };
        }

        const destinationPath = getAvailablePath(chosenPath);
        const job = queue.enqueue({
          kind: "clip",
          platform: request.platform,
          sourceId: request.clipId,
          title: request.title,
          channelName: request.channelName,
          destinationPath,
          qualityLabel: selectedQuality?.quality ?? null,
          thumbnailUrl: request.thumbnailUrl ?? null,
          source: {
            clip: {
              clipId: request.clipId,
              clipUrl: request.clipUrl,
              durationSeconds: request.durationSeconds ?? null,
              thumbnailUrl: request.thumbnailUrl,
            },
          },
        });

        const backgroundRun = (async () => {
          const refreshedPlayback = await resolvePlayback(request);
          if (
            queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status ===
            "cancelled"
          ) {
            return;
          }
          if (refreshedPlayback.format !== "mp4" && refreshedPlayback.format !== "hls") {
            throw new Error("Unsupported clip format");
          }
          const refreshedQuality = selectMatchingQuality(refreshedPlayback, selectedQuality);
          await runDownload({
            jobId: job.id,
            playback: refreshedPlayback,
            destinationPath,
            durationSeconds:
              refreshedPlayback.durationSeconds ??
              playback.durationSeconds ??
              request.durationSeconds ??
              null,
            selectedQuality: refreshedQuality,
            refreshPlayback: () => resolvePlayback(request),
          });
        })();
        void backgroundRun.catch((error) => {
          if (
            queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status ===
            "cancelled"
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : "Clip download failed";
          queue.updateTarget(job.id, { retryable: true });
          queue.fail(job.id, message);
        });
        return { success: true, jobId: job.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clip download failed";
        return { success: false, error: message };
      }
    },
    async retryClip(jobId) {
      const job = queue.getQueue().jobs.find((candidate) => candidate.id === jobId);
      if (!job || job.kind !== "clip" || !job.source?.clip) {
        return { success: false, jobId, error: "Download job not found" };
      }

      const request: ClipDownloadRequest = {
        platform: job.platform,
        clipId: job.source.clip.clipId,
        title: job.title,
        channelName: job.channelName,
        clipUrl: job.source.clip.clipUrl,
        durationSeconds: job.source.clip.durationSeconds ?? null,
        thumbnailUrl: job.source.clip.thumbnailUrl,
      };

      try {
        const playback = await resolvePlayback(request);
        if (playback.format !== "mp4" && playback.format !== "hls")
          throw new Error("Unsupported clip format");
        const selectedQuality =
          playback.qualities?.find((quality) => quality.quality === job.qualityLabel) ??
          playback.qualities?.[0] ??
          null;
        const destinationPath = getAvailablePath(job.destinationPath);
        queue.updateTarget(job.id, {
          destinationPath,
          qualityLabel: selectedQuality?.quality ?? job.qualityLabel ?? null,
        });
        queue.retry(job.id);
        return await runDownload({
          jobId: job.id,
          playback,
          destinationPath,
          durationSeconds: playback.durationSeconds ?? request.durationSeconds ?? null,
          selectedQuality,
          refreshPlayback: () => resolvePlayback(request),
        });
      } catch (error) {
        if (isSourceRemovedError(error)) {
          queue.remove(job.id);
          return { success: false, jobId: job.id, error: "Source removed" };
        }
        const retryAfterMs = getRetryAfterMs(error);
        if (retryAfterMs) {
          queue.updateTarget(job.id, {
            retryable: true,
            statusMessage: "Waiting for platform",
            nextRetryAt: new Date(Date.parse(now()) + retryAfterMs).toISOString(),
          });
          queue.wait(job.id);
          return { success: false, jobId: job.id, error: "Waiting for platform" };
        }
        const message = error instanceof Error ? error.message : "Clip download failed";
        queue.fail(job.id, message);
        return { success: false, jobId: job.id, error: message };
      }
    },
    cancel(jobId) {
      const controller = activeControllers.get(jobId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
  };
}
