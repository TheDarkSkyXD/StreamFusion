import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { LocalCaptionModelState } from "@shared/local-caption-types";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
  type LocalCaptionHandlerDependencies,
  registerLocalCaptionHandlers,
} from "@backend/ipc/handlers/local-caption-handlers";

type Handler = (event: unknown, payload?: unknown) => unknown;
const fileSender = { senderFrame: { url: "file:///app/renderer/index.html" } };

function handler(channel: string): Handler {
  const found = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel);
  if (!found) throw new Error(`Missing handler: ${channel}`);
  return found[1] as Handler;
}

function mainWindow(send = vi.fn()): BrowserWindow {
  return Object.assign(Object.create(null), {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send },
  });
}

const notInstalled: LocalCaptionModelState = {
  phase: "not-installed",
  languageLabel: "English",
  languageTag: "en",
  downloadBytes: 45_202_074,
  installedBytes: 45_202_074,
  displaySize: "43.11 MiB",
  license: "Apache-2.0",
  sourceName: "Hugging Face",
  sourceUrl: "https://huggingface.co/model",
  downloadedBytes: 0,
};

function dependencies(): LocalCaptionHandlerDependencies {
  return {
    modelStore: {
      getState: vi.fn(async () => notInstalled),
      install: vi.fn(async () => "C:/models/en"),
      cancel: vi.fn(),
      remove: vi.fn(async () => undefined),
      getActiveModelPath: vi.fn(async () => null),
      subscribe: vi.fn(() => vi.fn()),
    },
    supervisor: {
      start: vi.fn(),
      stop: vi.fn(),
      pushAudio: vi.fn(),
    },
  };
}

// Guards: the typed model lifecycle bridge reports honest state/progress and never exposes a filesystem path.
describe("local caption IPC handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes model state, explicit download, cancel, remove, and progress pushes", async () => {
    const deps = dependencies();
    const send = vi.fn();
    registerLocalCaptionHandlers(mainWindow(send), deps);

    await expect(handler(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_GET_STATE)(fileSender)).resolves.toEqual(
      notInstalled
    );
    await expect(handler(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_DOWNLOAD)(fileSender)).resolves.toEqual({
      success: true,
      state: notInstalled,
    });
    expect(deps.modelStore.install).toHaveBeenCalledTimes(1);

    const listener = vi.mocked(deps.modelStore.subscribe).mock.calls[0][0];
    listener({ ...notInstalled, phase: "downloading", downloadedBytes: 1_024 });
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_STATE, {
      ...notInstalled,
      phase: "downloading",
      downloadedBytes: 1_024,
    });

    handler(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_CANCEL)(fileSender);
    await handler(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_REMOVE)(fileSender);
    expect(deps.modelStore.cancel).toHaveBeenCalledTimes(1);
    expect(deps.modelStore.remove).toHaveBeenCalledTimes(1);
  });

  it("starts only a verified model lease and routes bounded audio plus Off teardown", async () => {
    const deps = dependencies();
    registerLocalCaptionHandlers(mainWindow(), deps);
    const identity = { sessionId: "kick:talker", generation: 5 };

    await expect(
      handler(IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START)(fileSender, identity)
    ).resolves.toEqual({ success: false, error: "Download and verify the English model first." });
    expect(deps.supervisor.start).not.toHaveBeenCalled();

    vi.mocked(deps.modelStore.getActiveModelPath).mockResolvedValue("C:/models/en");
    await expect(
      handler(IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_START)(fileSender, identity)
    ).resolves.toEqual({ success: true });
    expect(deps.supervisor.start).toHaveBeenCalledWith({
      ...identity,
      modelPath: "C:/models/en",
    });

    vi.mocked(deps.supervisor.pushAudio).mockReturnValue(true);
    const audio = {
      ...identity,
      sequence: 1,
      mediaTime: 42,
      sampleRate: 16_000 as const,
      samples: new Float32Array(3_200).buffer,
    };
    expect(handler(IPC_CHANNELS.LOCAL_CAPTIONS_AUDIO_PUSH)(fileSender, audio)).toEqual({
      accepted: true,
    });

    vi.mocked(deps.supervisor.stop).mockReturnValue(true);
    expect(handler(IPC_CHANNELS.LOCAL_CAPTIONS_SESSION_STOP)(fileSender, identity)).toEqual({
      success: true,
    });
    expect(deps.supervisor.stop).toHaveBeenCalledWith(identity);
  });
});
