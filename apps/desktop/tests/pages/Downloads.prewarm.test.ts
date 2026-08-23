import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

const prewarmViewportImages = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/viewport-image-prewarm", () => ({ prewarmViewportImages }));

import { _resetDownloadsPrewarmForTests, prewarmDownloadsFirstThumbnail } from "@/pages/Downloads";

// Guards: deterministic route warming fetches Downloads once and starts its first two priority visual thumbnails through the shared proxy/cache prewarmer.
describe("Downloads route prewarm", () => {
  beforeEach(() => {
    _resetDownloadsPrewarmForTests();
    prewarmViewportImages.mockClear();
  });

  it("deduplicates the queue read and prewarms the first two image-bearing visual rows", async () => {
    const api = installElectronAPIMock();
    api.downloads.getQueue = vi.fn<typeof api.downloads.getQueue>(async () => ({
      jobs: [
        {
          id: "completed",
          kind: "video" as const,
          platform: "twitch" as const,
          sourceId: "completed",
          title: "Completed",
          channelName: "completed",
          status: "completed" as const,
          progress: { percent: 100, transferredBytes: 1, totalBytes: 1 },
          thumbnailUrl: "https://example.com/completed.jpg",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          destinationPath: "C:\\Videos\\completed.mp4",
        },
        {
          id: "queued",
          kind: "clip" as const,
          platform: "twitch" as const,
          sourceId: "queued",
          title: "Queued",
          channelName: "queued",
          status: "queued" as const,
          progress: { percent: 0, transferredBytes: 0, totalBytes: 10 },
          thumbnailUrl: "https://example.com/queued.jpg",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          destinationPath: "C:\\Videos\\queued.mp4",
        },
        {
          id: "active",
          kind: "video" as const,
          platform: "kick" as const,
          sourceId: "active",
          title: "Active",
          channelName: "active",
          status: "downloading" as const,
          progress: { percent: 10, transferredBytes: 1, totalBytes: 10 },
          thumbnailUrl: "https://example.com/active.jpg",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          destinationPath: "C:\\Videos\\active.mp4",
        },
      ],
    }));

    await Promise.all([prewarmDownloadsFirstThumbnail(), prewarmDownloadsFirstThumbnail()]);

    expect(api.downloads.getQueue).toHaveBeenCalledTimes(1);
    expect(prewarmViewportImages).toHaveBeenCalledTimes(1);
    expect(prewarmViewportImages).toHaveBeenCalledWith([
      "https://example.com/active.jpg",
      "https://example.com/queued.jpg",
    ]);
  });
});
