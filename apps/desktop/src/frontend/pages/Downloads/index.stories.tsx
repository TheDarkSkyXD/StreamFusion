import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useLayoutEffect } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import type { ElectronAPI } from "@backend/preload";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";

import { DownloadsPage } from "./index";

type DownloadsBridge = ElectronAPI["downloads"];
type DownloadActions = Partial<
  Pick<DownloadsBridge, "cancel" | "deleteFile" | "openFile" | "remove" | "showInFolder">
>;

const emptyQueue = { jobs: [] } satisfies DownloadQueueSnapshot;

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "vod-road-to-radiant",
    kind: "video",
    platform: "twitch",
    sourceId: "2147483647",
    title: "Road to radiant with calm comms",
    channelName: "NovaArcade",
    status: "downloading",
    progress: {
      percent: 64,
      transferredBytes: 3_221_225_472,
      totalBytes: 5_033_164_800,
      bytesPerSecond: 8_388_608,
    },
    destinationPath: "D:\\StreamFusion\\Road to radiant with calm comms.mp4",
    // Intentionally omitted: the page renders its local video fallback instead of fetching a remote thumbnail.
    thumbnailUrl: null,
    createdAt: "2026-08-10T14:00:00.000Z",
    updatedAt: "2026-08-10T14:08:00.000Z",
    ...overrides,
  };
}

function createDownloadsBridge(
  getQueue: DownloadsBridge["getQueue"],
  actions: DownloadActions = {}
): DownloadsBridge {
  return {
    getQueue,
    downloadClip: async () => ({ success: true, jobId: "clip-story-job" }),
    downloadVideo: async () => ({ success: true, jobId: "video-story-job" }),
    pause: async () => ({ success: true }),
    resume: async () => ({ success: true }),
    cancel: actions.cancel ?? (async () => ({ success: true })),
    retry: async () => ({ success: true }),
    remove: actions.remove ?? (async () => ({ success: true })),
    showInFolder: actions.showInFolder ?? (async () => ({ success: true })),
    openFile: actions.openFile ?? (async () => ({ success: true })),
    deleteFile: actions.deleteFile ?? (async () => ({ success: true })),
    onQueueChanged: () => () => undefined,
  };
}

function DownloadsBridgeProvider({
  children,
  downloads,
}: {
  children: ReactNode;
  downloads: DownloadsBridge;
}) {
  useLayoutEffect(() => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const previousBridge = window.electronAPI;
    const electronApi = Object.create(previousBridge) as ElectronAPI;
    Object.defineProperty(electronApi, "downloads", { value: downloads });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: electronApi,
    });

    return () => {
      if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
      else Reflect.deleteProperty(window, "electronAPI");
    };
  }, [downloads]);

  return children;
}

function withDownloadsBridge(
  getQueue: DownloadsBridge["getQueue"],
  actions?: DownloadActions
): Decorator {
  const downloads = createDownloadsBridge(getQueue, actions);

  return (Story) => (
    <DownloadsBridgeProvider downloads={downloads}>
      <div className="h-[760px] min-w-[960px] overflow-hidden bg-[var(--color-background-primary)]">
        <Story />
      </div>
    </DownloadsBridgeProvider>
  );
}

function createRetryingQueue(): DownloadsBridge["getQueue"] {
  let attempts = 0;

  return async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Storybook queue fixture unavailable");
    return emptyQueue;
  };
}

const populatedQueue = {
  jobs: [
    downloadJob(),
    downloadJob({
      id: "clip-queued",
      kind: "clip",
      platform: "kick",
      sourceId: "clip-8a31",
      title: "Last-second save",
      channelName: "MiraMakes",
      status: "queued",
      progress: { percent: 0, transferredBytes: 0, totalBytes: 314_572_800 },
      statusMessage: "Queued behind the current VOD",
    }),
    downloadJob({
      id: "vod-complete",
      sourceId: "2147484001",
      title: "Championship VOD",
      status: "completed",
      progress: { percent: 100, transferredBytes: 6_291_456_000, totalBytes: 6_291_456_000 },
      outputFormat: "mp4",
    }),
    downloadJob({
      id: "clip-failed",
      kind: "clip",
      platform: "kick",
      sourceId: "clip-91cf",
      title: "Highlight no longer available",
      channelName: "MiraMakes",
      status: "failed",
      progress: { percent: null, transferredBytes: 104_857_600, totalBytes: null },
      error: "The platform no longer provides this clip.",
    }),
    downloadJob({
      id: "vod-waiting",
      sourceId: "2147484100",
      title: "Late-night ladder session",
      status: "waiting",
      progress: { percent: null, transferredBytes: 0, totalBytes: null },
      statusMessage: "Waiting for platform playback access",
    }),
  ],
} satisfies DownloadQueueSnapshot;

const cancelActiveDownload = fn(async () => ({ success: true }));

const meta = {
  title: "Pages/Downloads",
  component: DownloadsPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Download-manager states with a local Electron bridge fixture. The stories use fixed queue snapshots, fallback thumbnails, and no-op file actions, so they never start IPC work or fetch media.",
      },
    },
  },
} satisfies Meta<typeof DownloadsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  decorators: [withDownloadsBridge(async () => populatedQueue)],
};

export const Empty: Story = {
  decorators: [withDownloadsBridge(async () => emptyQueue)],
};

export const CancelActiveDownload: Story = {
  decorators: [
    withDownloadsBridge(async () => ({ jobs: [populatedQueue.jobs[0]] }), {
      cancel: cancelActiveDownload,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Cancel Road to radiant with calm comms" })
    );
    await expect(cancelActiveDownload).toHaveBeenCalledWith("vod-road-to-radiant");
  },
};

export const ErrorThenRetry: Story = {
  decorators: [withDownloadsBridge(createRetryingQueue())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("alert");
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(await canvas.findByText("No downloads yet")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  decorators: [
    withDownloadsBridge(async () => {
      throw new Error("Storybook queue fixture unavailable");
    }),
  ],
};
