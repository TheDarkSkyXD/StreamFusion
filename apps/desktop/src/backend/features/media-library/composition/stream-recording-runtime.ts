import { existsSync } from "node:fs";
import path from "node:path";

import { app, dialog, Notification, session, shell } from "electron";

import { preferencesRepository } from "@backend/features/settings/data/preferences-repository";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import type { StreamRecordingRequest } from "@shared/stream-recording-types";
import { getNativeText } from "../../../services/native-copy";
import { KickStreamResolver } from "../../playback/adapters/kick/kick-stream-resolver";
import { TwitchStreamResolver } from "../../playback/adapters/twitch/twitch-stream-resolver";
import {
  resolveFfmpegPath,
  startHlsRecordingWithFfmpeg,
} from "../adapters/ffmpeg/ffmpeg-download-service";
import {
  buildDownloadFilename,
  getAvailableDestinationPath,
} from "../adapters/node/download-paths";
import { createStreamRecordingArtifactProbe } from "../adapters/node/stream-recording-artifact-probe";
import {
  createOwnedRecordingSectionPath,
  isOwnedRecordingOutput,
  isOwnedRecordingSection,
  isRecordingSectionAvailable,
} from "../adapters/node/stream-recording-paths";
import {
  cleanupRecordingSectionPaths,
  createStreamRecordingSectionFinalizer,
  deleteRecordingArtifactPaths,
  verifyStreamRecordingArtifactIdentity,
} from "../adapters/node/stream-recording-section-finalizer";
import type { StreamRecordingLifecycle } from "../capabilities/stream-recording-lifecycle";
import { getStreamRecordingSessionStore } from "../data/stream-recording-session-store";
import { createStreamRecordingOutcomeCoordinator } from "../domain/stream-recording-outcome-coordinator";
import { fetchStreamRecordingQualityCatalog } from "../domain/stream-recording-quality-catalog";
import {
  createStreamRecordingService,
  type StreamRecordingService,
} from "../domain/stream-recording-service";

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
  const lifecycle: StreamRecordingLifecycle = {
    sectionFinalizer: createStreamRecordingSectionFinalizer(),
    probeArtifact: createStreamRecordingArtifactProbe(),
    cleanupSections: cleanupRecordingSectionPaths,
    discardArtifacts: deleteRecordingArtifactPaths,
    cleanupFailedArtifact: cleanupRecordingSectionPaths,
    cleanupAbortedSection: async (sectionPath) => cleanupRecordingSectionPaths([sectionPath]),
    isRecordingSectionAvailable,
    verifyArtifactIdentity: verifyStreamRecordingArtifactIdentity,
    createSectionPath: (destinationPath, sectionNumber, sessionId) =>
      createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber),
    isOwnedRecordingSection,
    isOwnedRecordingOutput,
  };
  const outcomeCoordinator = createStreamRecordingOutcomeCoordinator({
    sessionStore,
    getDeliveryContext: () => {
      const mainWindow = renderer.current();
      const notifications = preferencesRepository.getPreferences().notifications;
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
    lifecycle,
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
