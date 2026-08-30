import { existsSync } from "node:fs";

import { dialog } from "electron";

import type { ClipDownloadRequest } from "@shared/download-types";
import { TwitchStreamResolver } from "../api/platforms/twitch/twitch-stream-resolver";
import { type ClipDownloadService, createClipDownloadService } from "./clip-download-service";
import { downloadDirectFile } from "./direct-file-download-service";
import { assertAllowedRendererMediaUrl } from "./download-media-source";
import { getAvailableDestinationPath } from "./download-paths";
import type { DownloadQueueService } from "./download-queue-service";
import { chooseDefaultDownloadSavePath } from "./download-save-dialog";
import { downloadHlsWithFfmpeg, resolveFfmpegPath } from "./ffmpeg-download-service";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

const twitchResolver = new TwitchStreamResolver();
let clipDownloadService: ClipDownloadService | null = null;

interface ClipPlaybackResolver {
  getClipPlaybackUrl(clipId: string): Promise<{
    url: string;
    format: string;
    durationSeconds?: number | null;
    qualities?: Array<{ quality: string; url: string }>;
  }>;
}

export async function resolveDefaultClipPlayback(
  request: ClipDownloadRequest,
  twitch: ClipPlaybackResolver = twitchResolver
) {
  if (request.platform === "twitch") {
    return twitch.getClipPlaybackUrl(request.clipId);
  }

  if (!request.clipUrl) {
    throw new Error("Clip URL required for Kick clip download");
  }

  const url = assertAllowedRendererMediaUrl({
    platform: "kick",
    kind: "clip",
    url: request.clipUrl,
  });
  return {
    url,
    format: new URL(url).pathname.toLowerCase().endsWith(".m3u8") ? "hls" : "mp4",
  };
}

export function getDefaultClipDownloadService(
  renderer: MainRendererPort,
  queue: DownloadQueueService
): ClipDownloadService {
  if (clipDownloadService) return clipDownloadService;

  clipDownloadService = createClipDownloadService({
    queue,
    resolvePlayback: resolveDefaultClipPlayback,
    chooseQuality: async (qualities) => {
      const mainWindow = renderer.current();
      if (!mainWindow) return null;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Choose clip quality",
        message: "Choose clip quality",
        buttons: [...qualities.map((quality) => quality.quality), "Cancel"],
        defaultId: 0,
        cancelId: qualities.length,
      });
      return result.response >= qualities.length ? null : qualities[result.response];
    },
    chooseSavePath: (request, extension) => {
      const mainWindow = renderer.current();
      if (!mainWindow) return Promise.resolve(null);
      return chooseDefaultDownloadSavePath(mainWindow, {
        dialogTitle: "Save clip",
        channelName: request.channelName,
        title: request.title,
        extension,
      });
    },
    getAvailablePath: (requestedPath) => getAvailableDestinationPath(requestedPath, existsSync),
    downloadFile: downloadDirectFile,
    resolveFfmpegPath,
    downloadHls: downloadHlsWithFfmpeg,
  });

  return clipDownloadService;
}
