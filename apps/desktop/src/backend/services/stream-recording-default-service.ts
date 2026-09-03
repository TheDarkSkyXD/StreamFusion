import { existsSync } from "node:fs";
import path from "node:path";

import { app, dialog, Notification, session, shell } from "electron";

import type { StreamRecordingRequest } from "@shared/stream-recording-types";
import { KickStreamResolver } from "../api/platforms/kick/kick-stream-resolver";
import { TwitchStreamResolver } from "../api/platforms/twitch/twitch-stream-resolver";
import { buildDownloadFilename, getAvailableDestinationPath } from "./download-paths";
import { resolveFfmpegPath, startHlsRecordingWithFfmpeg } from "./ffmpeg-download-service";
import { getNativeText } from "./native-copy";
import { storageService } from "./storage-service";
import { createStreamRecordingOutcomeCoordinator } from "./stream-recording-outcome-coordinator";
import { fetchStreamRecordingQualityCatalog } from "./stream-recording-quality-catalog";
import { verifyStreamRecordingArtifactIdentity } from "./stream-recording-section-finalizer";
import {
  createStreamRecordingService,
  type StreamRecordingService,
} from "./stream-recording-service";
import { getStreamRecordingSessionStore } from "./stream-recording-session-store";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

const twitchResolver = new TwitchStreamResolver();
const kickResolver = new KickStreamResolver();
let streamRecordingService: StreamRecordingService | null = null;

export function getDefaultStreamRecordingService(
  renderer: MainRendererPort
): StreamRecordingService {
  if (streamRecordingService) return streamRecordingService;

  const sessionStore = getStreamRecordingSessionStore();
  const recordingFileActions = {
    exists: existsSync,
    openPath: (filePath: string) => shell.openPath(filePath),
    showItemInFolder: (filePath: string) => shell.showItemInFolder(filePath),
  };
  const outcomeCoordinator = createStreamRecordingOutcomeCoordinator({
    sessionStore,
    getDeliveryContext: () => {
      const mainWindow = renderer.current();
      const notifications = storageService.getPreferences().notifications;
      return {
        visible: mainWindow?.isVisible() ?? false,
        focused: mainWindow?.isFocused() ?? false,
        minimized: mainWindow?.isMinimized() ?? false,
        notificationsEnabled: notifications.enabled,
        soundEnabled: notifications.sound,
        nativeSupported: Notification.isSupported(),
      };
    },
    showNative: ({ title, body, silent, onClick }) => {
      const notification = new Notification({ title, body, silent });
      notification.on("click", onClick);
      notification.show();
    },
    focusWindow: () => {
      const mainWindow = renderer.current();
      if (!mainWindow) return;
      if (mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    recordingFileActions,
    verifyArtifactIdentity: verifyStreamRecordingArtifactIdentity,
    getText: getNativeText,
    // timer-allowlist: recording outcomes are intentionally transient and session-scoped
    scheduleClear: (callback, delayMs) => setTimeout(callback, delayMs),
  });

  streamRecordingService = createStreamRecordingService({
    sessionStore,
    resolvePlayback: async (request: StreamRecordingRequest, signal, options) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const playback =
        request.platform === "twitch"
          ? twitchResolver.getStreamPlaybackUrl(request.channelName)
          : kickResolver.getStreamPlaybackUrl(request.channelName, {
              forceRefresh: options?.forceRefresh === true,
            });
      const result = await playback;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return result;
    },
    resolveQualityCatalog: (playback, signal) =>
      fetchStreamRecordingQualityCatalog({
        masterUrl: playback.url,
        signal,
        fetchPlaylist: (url, init) => session.defaultSession.fetch(url, init),
      }),
    chooseQuality: async (qualities) => {
      const mainWindow = renderer.current();
      if (!mainWindow) return null;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: getNativeText("chooseStreamQuality"),
        message: getNativeText("chooseStreamQuality"),
        buttons: [...qualities.map((quality) => quality.quality), getNativeText("cancel")],
        defaultId: 0,
        cancelId: qualities.length,
      });
      return result.response >= qualities.length ? null : qualities[result.response];
    },
    chooseSavePath: async (request, extension) => {
      const mainWindow = renderer.current();
      if (!mainWindow) return null;
      const defaultPath = path.join(
        app.getPath("downloads"),
        buildDownloadFilename(request.channelName, request.title, extension)
      );
      const result = await dialog.showSaveDialog(mainWindow, {
        title: getNativeText("saveStreamRecording"),
        defaultPath,
        filters: [{ name: getNativeText("mp4Video"), extensions: ["mp4"] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
    getAvailablePath: (requestedPath) => getAvailableDestinationPath(requestedPath, existsSync),
    resolveFfmpegPath,
    startRecorder: startHlsRecordingWithFfmpeg,
    recordingFileActions,
    outcomeCoordinator,
  });

  return streamRecordingService;
}
