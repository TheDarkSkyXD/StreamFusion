import { existsSync } from "node:fs";

import type { VideoDownloadRequest } from "@shared/download-types";
import { KickStreamResolver } from "../../playback/adapters/kick/kick-stream-resolver";
import { TwitchStreamResolver } from "../../playback/adapters/twitch/twitch-stream-resolver";
import { assertAllowedRendererMediaUrl } from "../domain/download-media-source";
import { getAvailableDestinationPath } from "../adapters/node/download-paths";
import { getNativeText } from "../../../services/native-copy";
import type { DownloadQueueService } from "../domain/download-queue-service";
import { chooseDefaultDownloadSavePath } from "../adapters/electron/download-save-dialog";
import { downloadHlsWithFfmpeg, resolveFfmpegPath } from "../adapters/ffmpeg/ffmpeg-download-service";
import { createVideoDownloadService, type VideoDownloadService } from "../domain/video-download-service";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

const twitchResolver = new TwitchStreamResolver();
const kickResolver = new KickStreamResolver();
let videoDownloadService: VideoDownloadService | null = null;

interface VodPlaybackResolver {
  getVodPlaybackUrl(videoId: string): Promise<{ url: string; format: string }>;
}

export async function resolveDefaultVideoPlayback(
  request: VideoDownloadRequest,
  {
    twitchResolver: twitch = twitchResolver,
    kickResolver: kick = kickResolver,
  }: { twitchResolver?: VodPlaybackResolver; kickResolver?: VodPlaybackResolver } = {}
): Promise<{ url: string; format: string; durationSeconds: number | null }> {
  if (request.platform === "twitch") {
    const playback = await twitch.getVodPlaybackUrl(request.videoId);
    return { ...playback, durationSeconds: request.durationSeconds ?? null };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(request.videoId) || request.videoId.startsWith("//")) {
    throw new Error("Invalid Kick video id");
  }

  try {
    const playback = await kick.getVodPlaybackUrl(request.videoId);
    return { ...playback, durationSeconds: request.durationSeconds ?? null };
  } catch (error) {
    if (!request.playbackUrl) throw error;
    return {
      url: assertAllowedRendererMediaUrl({
        platform: "kick",
        kind: "video",
        url: request.playbackUrl,
      }),
      format: "hls",
      durationSeconds: request.durationSeconds ?? null,
    };
  }
}

export function getDefaultVideoDownloadService(
  renderer: MainRendererPort,
  queue: DownloadQueueService
): VideoDownloadService {
  if (videoDownloadService) return videoDownloadService;

  videoDownloadService = createVideoDownloadService({
    queue,
    resolvePlayback: resolveDefaultVideoPlayback,
    chooseSavePath: (request, extension) => {
      const mainWindow = renderer.current();
      if (!mainWindow) return Promise.resolve(null);
      return chooseDefaultDownloadSavePath(mainWindow, {
        dialogTitle: getNativeText("saveVideo"),
        channelName: request.channelName,
        title: request.title,
        extension,
        videoFilterName: getNativeText("mp4Video"),
      });
    },
    getAvailablePath: (requestedPath) => getAvailableDestinationPath(requestedPath, existsSync),
    resolveFfmpegPath,
    downloadHls: downloadHlsWithFfmpeg,
  });

  return videoDownloadService;
}
