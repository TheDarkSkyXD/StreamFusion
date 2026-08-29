import type { VideoDownloadRequest } from "@shared/download-types";
import type { DownloadQueueService } from "./download-queue-service";
import type { FfmpegProgress } from "./ffmpeg-download-service";

export interface VideoPlaybackResult {
  url: string;
  format: string;
  durationSeconds?: number | null;
}

export interface VideoDownloadService {
  downloadVideo(request: VideoDownloadRequest): Promise<{
    success: boolean;
    jobId?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  cancel(jobId: string): boolean;
}

export function createVideoDownloadService({
  queue,
  resolvePlayback,
  chooseSavePath,
  getAvailablePath,
  resolveFfmpegPath,
  downloadHls,
}: {
  queue: DownloadQueueService;
  resolvePlayback: (request: VideoDownloadRequest) => Promise<VideoPlaybackResult>;
  chooseSavePath: (request: VideoDownloadRequest, extension: string) => Promise<string | null>;
  getAvailablePath: (path: string) => string;
  resolveFfmpegPath: () => string;
  downloadHls: (input: {
    ffmpegPath: string;
    inputUrl: string;
    destinationPath: string;
    durationSeconds?: number | null;
    signal: AbortSignal;
    onProgress: (progress: FfmpegProgress) => void;
  }) => Promise<{ outputPath: string; format: "mp4" | "ts"; outputBytes?: number }>;
}): VideoDownloadService {
  let activeVideoRun = Promise.resolve();
  const activeControllers = new Map<string, AbortController>();

  return {
    async downloadVideo(request) {
      try {
        const chosenPath = await chooseSavePath(request, ".mp4");
        if (!chosenPath) return { success: false, cancelled: true, error: "Save cancelled" };

        const destinationPath = getAvailablePath(chosenPath);
        const job = queue.enqueue({
          kind: "video",
          platform: request.platform,
          sourceId: request.videoId,
          title: request.title,
          channelName: request.channelName,
          destinationPath,
          thumbnailUrl: request.thumbnailUrl ?? null,
          source: {
            video: {
              videoId: request.videoId,
              durationSeconds: request.durationSeconds ?? null,
              thumbnailUrl: request.thumbnailUrl,
            },
          },
        });

        const run = activeVideoRun.then(async () => {
          if (
            queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status ===
            "cancelled"
          ) {
            return;
          }

          const controller = new AbortController();
          activeControllers.set(job.id, controller);
          try {
            const playback = await resolvePlayback(request);
            if (
              controller.signal.aborted ||
              queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status ===
                "cancelled"
            ) {
              if (
                queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status !==
                "cancelled"
              ) {
                queue.cancel(job.id);
              }
              return;
            }
            if (playback.format !== "hls") {
              throw new Error("Only HLS video downloads are supported");
            }
            queue.start(job.id);
            const result = await downloadHls({
              ffmpegPath: resolveFfmpegPath(),
              inputUrl: playback.url,
              destinationPath,
              durationSeconds: playback.durationSeconds ?? request.durationSeconds ?? null,
              signal: controller.signal,
              onProgress: (progress) => {
                if (controller.signal.aborted) return;
                queue.updateProgress(job.id, {
                  percent: progress.percent,
                  transferredBytes: progress.outputBytes ?? 0,
                  totalBytes: null,
                });
              },
            });
            if (controller.signal.aborted) {
              queue.cancel(job.id);
              return;
            }
            if (typeof result.outputBytes === "number") {
              queue.updateProgress(job.id, {
                percent: 100,
                transferredBytes: result.outputBytes,
                totalBytes: result.outputBytes,
              });
            }
            queue.updateTarget(job.id, {
              destinationPath: result.outputPath,
              outputFormat: result.format,
            });
            queue.complete(job.id);
          } catch (error) {
            if (
              controller.signal.aborted ||
              queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status ===
                "cancelled"
            ) {
              if (
                queue.getQueue().jobs.find((candidate) => candidate.id === job.id)?.status !==
                "cancelled"
              ) {
                queue.cancel(job.id);
              }
              return;
            }
            const message = error instanceof Error ? error.message : "Video download failed";
            queue.fail(job.id, message);
          } finally {
            if (activeControllers.get(job.id) === controller) {
              activeControllers.delete(job.id);
            }
          }
        });

        activeVideoRun = run.then(
          () => undefined,
          () => undefined
        );
        return { success: true, jobId: job.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Video download failed";
        return { success: false, error: message };
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
