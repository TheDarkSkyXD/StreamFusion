import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: class {
    webContents = { send: vi.fn() };
    isDestroyed = () => false;
  },
}));

vi.mock("@backend/services/download-queue-service", () => ({
  getDownloadQueueService: vi.fn(),
}));

vi.mock("@backend/services/download-file-actions-service", () => ({
  getDefaultDownloadFileActionsService: vi.fn(),
}));

vi.mock("@backend/services/clip-download-default-service", () => ({
  getDefaultClipDownloadService: vi.fn(),
}));

vi.mock("@backend/services/video-download-default-service", () => ({
  getDefaultVideoDownloadService: vi.fn(),
}));

vi.mock("@backend/ipc/sender-origin", () => ({
  isAllowedSender: vi.fn(() => true),
}));

import { BrowserWindow, ipcMain } from "electron";

import { registerDownloadHandlers } from "@backend/ipc/handlers/download-handlers";
import { isAllowedSender } from "@backend/ipc/sender-origin";
import { getDefaultClipDownloadService } from "@backend/services/clip-download-default-service";
import { getDefaultDownloadFileActionsService } from "@backend/services/download-file-actions-service";
import { getDownloadQueueService } from "@backend/services/download-queue-service";
import { getDefaultVideoDownloadService } from "@backend/services/video-download-default-service";
import type { DownloadQueueService } from "@backend/services/download-queue-service";
import type { ClipDownloadService } from "@backend/services/clip-download-service";
import type { VideoDownloadService } from "@backend/services/video-download-service";
import type { DownloadFileActionsService } from "@backend/services/download-file-actions-service";

type Handler = (event: unknown, payload?: unknown) => unknown;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, payload) => Reflect.apply(call[1], undefined, [event, payload]);
}

const service = {
  getQueue: vi.fn(),
  enqueue: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  updateTarget: vi.fn(),
  updateProgress: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
} satisfies DownloadQueueService;

const clipDownloads = {
  downloadClip: vi.fn(),
  retryClip: vi.fn(),
  cancel: vi.fn(),
} satisfies ClipDownloadService;

const videoDownloads = {
  downloadVideo: vi.fn(),
  cancel: vi.fn(),
} satisfies VideoDownloadService;

const fileActions = {
  showInFolder: vi.fn(),
  openFile: vi.fn(),
  removeFromList: vi.fn(),
  deleteFile: vi.fn(),
} satisfies DownloadFileActionsService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipcMain.handle).mockReset();
  vi.mocked(ipcMain.removeHandler).mockReset();
  vi.mocked(getDownloadQueueService).mockReturnValue(service);
  vi.mocked(getDefaultClipDownloadService).mockReturnValue(clipDownloads);
  vi.mocked(getDefaultVideoDownloadService).mockReturnValue(videoDownloads);
  vi.mocked(getDefaultDownloadFileActionsService).mockReturnValue(fileActions);
  vi.mocked(isAllowedSender).mockReturnValue(true);
  registerDownloadHandlers(new BrowserWindow());
});

// Guards: Downloads exposes dedicated workflows, never a generic renderer-controlled queue insertion primitive
// Guards: every download operation must have a distinct IPC channel so registrations cannot overwrite one another
// Guards: clip and video download requests must reach their dedicated main-process services without requiring auth
// Guards: untrusted renderer origins cannot trigger filesystem-writing download operations
describe("registerDownloadHandlers", () => {
  it("rolls back partial handler registration before a retry", () => {
    vi.clearAllMocks();
    vi.mocked(ipcMain.handle).mockImplementation((channel) => {
      if (channel === IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO) {
        throw new Error("registration failed");
      }
    });

    expect(() => registerDownloadHandlers(new BrowserWindow())).toThrow("registration failed");
    expect(vi.mocked(ipcMain.removeHandler).mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.DOWNLOADS_GET_QUEUE,
      IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP,
    ]);
    expect(service.subscribe).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(ipcMain.handle).mockReset();
    expect(() => registerDownloadHandlers(new BrowserWindow())).not.toThrow();
    expect(ipcMain.handle).toHaveBeenCalledTimes(11);
    expect(service.subscribe).toHaveBeenCalledOnce();
  });

  it("registers Downloads queue IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels.every((channel) => typeof channel === "string")).toBe(true);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_GET_QUEUE);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO);
    expect(channels).not.toContain("downloads:enqueue");
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_PAUSE);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_RESUME);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_CANCEL);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_RETRY);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_REMOVE);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_OPEN_FILE);
    expect(channels).toContain(IPC_CHANNELS.DOWNLOADS_DELETE_FILE);
  });

  it("delegates queue reads and controls to the service", () => {
    const queue = { jobs: [] };
    service.getQueue.mockReturnValue(queue);
    service.pause.mockReturnValue({ id: "job-1", status: "paused" });

    expect(getHandler(IPC_CHANNELS.DOWNLOADS_GET_QUEUE)({})).toBe(queue);
    expect(getHandler(IPC_CHANNELS.DOWNLOADS_PAUSE)({}, { id: "job-1" })).toEqual({
      success: true,
      job: { id: "job-1", status: "paused" },
    });
    expect(service.pause).toHaveBeenCalledWith("job-1");
  });

  it("starts clip downloads through the clip download service", async () => {
    const payload = {
      platform: "twitch",
      clipId: "ace",
      title: "Ace",
      channelName: "fpshero",
    };
    clipDownloads.downloadClip.mockResolvedValue({ success: true, jobId: "clip-job-1" });

    await expect(getHandler(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_CLIP)({}, payload)).resolves.toEqual({
      success: true,
      jobId: "clip-job-1",
    });
    expect(clipDownloads.downloadClip).toHaveBeenCalledWith(payload);
  });

  it("starts video downloads through the video download service", async () => {
    const payload = {
      platform: "twitch",
      videoId: "123",
      title: "Finals",
      channelName: "speedrunpro",
    };
    videoDownloads.downloadVideo.mockResolvedValue({ success: true, jobId: "video-job-1" });

    await expect(getHandler(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO)({}, payload)).resolves.toEqual({
      success: true,
      jobId: "video-job-1",
    });
    expect(videoDownloads.downloadVideo).toHaveBeenCalledWith(payload);
  });

  it("rejects downloads from an untrusted renderer origin", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(false);

    expect(getHandler(IPC_CHANNELS.DOWNLOADS_DOWNLOAD_VIDEO)({}, { videoId: "123" })).toEqual({
      success: false,
      error: "Rejected: caller is not the application renderer.",
    });
    expect(videoDownloads.downloadVideo).not.toHaveBeenCalled();
  });

  it("aborts active clip downloads before falling back to queue cancellation", () => {
    clipDownloads.cancel.mockReturnValue(true);

    expect(getHandler(IPC_CHANNELS.DOWNLOADS_CANCEL)({}, { id: "clip-job-1" })).toEqual({
      success: true,
    });
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it("aborts active video downloads before falling back to queue cancellation", () => {
    clipDownloads.cancel.mockReturnValue(false);
    videoDownloads.cancel.mockReturnValue(true);

    expect(getHandler(IPC_CHANNELS.DOWNLOADS_CANCEL)({}, { id: "video-job-1" })).toEqual({
      success: true,
    });
    expect(videoDownloads.cancel).toHaveBeenCalledWith("video-job-1");
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it("routes clip retries through the clip download service", async () => {
    service.getQueue.mockReturnValue({
      jobs: [{ id: "clip-job-1", kind: "clip", source: { clip: { clipId: "ace" } } }],
    });
    clipDownloads.retryClip.mockResolvedValue({ success: true, jobId: "clip-job-1" });

    await expect(
      getHandler(IPC_CHANNELS.DOWNLOADS_RETRY)({}, { id: "clip-job-1" })
    ).resolves.toEqual({
      success: true,
      jobId: "clip-job-1",
    });
    expect(clipDownloads.retryClip).toHaveBeenCalledWith("clip-job-1");
    expect(service.retry).not.toHaveBeenCalled();
  });

  it("delegates completed file actions to the file actions service", async () => {
    fileActions.showInFolder.mockResolvedValue({ success: true });
    fileActions.openFile.mockResolvedValue({ success: true });
    fileActions.deleteFile.mockResolvedValue({ success: true });
    fileActions.removeFromList.mockResolvedValue({ success: true });

    await expect(
      getHandler(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER)({}, { id: "job-1" })
    ).resolves.toEqual({ success: true });
    await expect(
      getHandler(IPC_CHANNELS.DOWNLOADS_OPEN_FILE)({}, { id: "job-1" })
    ).resolves.toEqual({ success: true });
    await expect(
      getHandler(IPC_CHANNELS.DOWNLOADS_DELETE_FILE)({}, { id: "job-1" })
    ).resolves.toEqual({ success: true });
    await expect(getHandler(IPC_CHANNELS.DOWNLOADS_REMOVE)({}, { id: "job-1" })).resolves.toEqual({
      success: true,
    });

    expect(fileActions.showInFolder).toHaveBeenCalledWith("job-1");
    expect(fileActions.openFile).toHaveBeenCalledWith("job-1");
    expect(fileActions.deleteFile).toHaveBeenCalledWith("job-1");
    expect(fileActions.removeFromList).toHaveBeenCalledWith("job-1");
    expect(service.remove).not.toHaveBeenCalled();
  });
});
