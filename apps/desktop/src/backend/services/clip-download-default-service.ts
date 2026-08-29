import { existsSync } from "node:fs";
import path from "node:path";

import { app, type BrowserWindow, dialog } from "electron";

import type { ClipDownloadRequest } from "@shared/download-types";
import { TwitchStreamResolver } from "../api/platforms/twitch/twitch-stream-resolver";
import { type ClipDownloadService, createClipDownloadService } from "./clip-download-service";
import { downloadDirectFile } from "./direct-file-download-service";
import { assertAllowedRendererMediaUrl } from "./download-media-source";
import { buildDownloadFilename, getAvailableDestinationPath } from "./download-paths";
import type { DownloadQueueService } from "./download-queue-service";
import { downloadHlsWithFfmpeg, resolveFfmpegPath } from "./ffmpeg-download-service";

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
  mainWindow: BrowserWindow,
  queue: DownloadQueueService
): ClipDownloadService {
  if (clipDownloadService) return clipDownloadService;

  clipDownloadService = createClipDownloadService({
    queue,
    resolvePlayback: resolveDefaultClipPlayback,
    chooseQuality: async (qualities) => {
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
    chooseSavePath: async (request, extension) => {
      const defaultPath = path.join(
        app.getPath("downloads"),
        buildDownloadFilename(request.channelName, request.title, extension)
      );
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "Save clip",
        defaultPath,
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
    getAvailablePath: (requestedPath) => getAvailableDestinationPath(requestedPath, existsSync),
    downloadFile: downloadDirectFile,
    resolveFfmpegPath,
    downloadHls: downloadHlsWithFfmpeg,
  });

  return clipDownloadService;
}
