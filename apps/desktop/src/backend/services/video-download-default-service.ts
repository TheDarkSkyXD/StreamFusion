import { existsSync } from "node:fs";

import { type BrowserWindow } from "electron";

import type { VideoDownloadRequest } from "@shared/download-types";
import { KickStreamResolver } from "../api/platforms/kick/kick-stream-resolver";
import { TwitchStreamResolver } from "../api/platforms/twitch/twitch-stream-resolver";
import { assertAllowedRendererMediaUrl } from "./download-media-source";
import { getAvailableDestinationPath } from "./download-paths";
import type { DownloadQueueService } from "./download-queue-service";
import { chooseDefaultDownloadSavePath } from "./download-save-dialog";
import { downloadHlsWithFfmpeg, resolveFfmpegPath } from "./ffmpeg-download-service";
import { createVideoDownloadService, type VideoDownloadService } from "./video-download-service";

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
  mainWindow: BrowserWindow,
  queue: DownloadQueueService
): VideoDownloadService {
  if (videoDownloadService) return videoDownloadService;

  videoDownloadService = createVideoDownloadService({
    queue,
    resolvePlayback: resolveDefaultVideoPlayback,
    chooseSavePath: (request, extension) =>
      chooseDefaultDownloadSavePath(mainWindow, {
        dialogTitle: "Save video",
        channelName: request.channelName,
        title: request.title,
        extension,
      }),
    getAvailablePath: (requestedPath) => getAvailableDestinationPath(requestedPath, existsSync),
    resolveFfmpegPath,
    downloadHls: downloadHlsWithFfmpeg,
  });

  return videoDownloadService;
}
