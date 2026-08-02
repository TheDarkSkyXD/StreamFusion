import { beforeEach, describe, expect, it, vi } from "vitest";

const prewarmViewportImagesMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/viewport-image-prewarm", () => ({
  prewarmViewportImages: prewarmViewportImagesMock,
}));

import {
  prewarmRecentStreamImages,
  rememberRecentStreamImages,
  resetRecentStreamPrewarmForTests,
} from "@/hooks/queries/recent-stream-prewarm";
import { installElectronAPIMock } from "../../test-utils";

// Guards: recent Stream poster prewarm persists only four route identities and keeps the newest first.
// Guards: startup prewarm forwards persisted poster URLs through the proxy-aware viewport warmer.
describe("recent stream image prewarm", () => {
  let stored: unknown;

  beforeEach(() => {
    const api = installElectronAPIMock();
    stored = null;
    api.store.get = vi.fn(async () => stored);
    api.store.set = vi.fn(async (_key, value) => {
      stored = value;
    });
    prewarmViewportImagesMock.mockClear();
    resetRecentStreamPrewarmForTests();
  });

  it("keeps a bounded newest-first index", async () => {
    for (let index = 0; index < 5; index++) {
      await rememberRecentStreamImages("kick", `Channel${index}`, [
        `https://images.kick.com/poster-${index}.webp`,
      ]);
    }

    expect(stored).toMatchObject({
      version: 1,
      entries: [
        { channelName: "channel4" },
        { channelName: "channel3" },
        { channelName: "channel2" },
        { channelName: "channel1" },
      ],
    });
  });

  it("prewarms persisted posters at startup", async () => {
    await rememberRecentStreamImages("twitch", "Ninja", [
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_ninja-320x180.jpg",
      "https://example.com/vod.jpg",
    ]);

    await prewarmRecentStreamImages();

    expect(prewarmViewportImagesMock).toHaveBeenCalledWith([
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_ninja-320x180.jpg",
      "https://example.com/vod.jpg",
    ]);
  });
});
