import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlaybackPositionStore } from "@/store/playback-position-store";

function resetStore() {
  usePlaybackPositionStore.setState({ positions: {} });
}

beforeEach(() => resetStore());

describe("playback-position-store savePosition", () => {
  it("saves a position with the correct key", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 60, 3600, "Title", "thumb.jpg");
    const pos = usePlaybackPositionStore.getState().getPosition("kick", "v1");
    expect(pos).toMatchObject({
      videoId: "v1",
      platform: "kick",
      position: 60,
      duration: 3600,
      title: "Title",
      thumbnail: "thumb.jpg",
    });
    expect(pos!.lastUpdated).toBeGreaterThan(0);
  });

  it("does not save if position is below 30 seconds", () => {
    usePlaybackPositionStore.getState().savePosition("twitch", "v1", 10, 3600);
    expect(usePlaybackPositionStore.getState().getPosition("twitch", "v1")).toBeNull();
  });

  it("keeps the entry when the video is over 95% watched so completed progress stays visible", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 60, 3600);
    expect(usePlaybackPositionStore.getState().getPosition("kick", "v1")).not.toBeNull();
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 3500, 3600);
    expect(usePlaybackPositionStore.getState().getPosition("kick", "v1")).toMatchObject({
      position: 3500,
      duration: 3600,
    });
  });

  it("updates an existing entry on re-save", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 60, 3600);
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 120, 3600);
    expect(usePlaybackPositionStore.getState().getPosition("kick", "v1")!.position).toBe(120);
  });

  it("enforces a max of 100 stored positions (oldest evicted)", () => {
    for (let i = 0; i < 105; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1_000_000 + i);
      usePlaybackPositionStore.getState().savePosition("kick", `v${i}`, 60, 3600);
    }
    vi.restoreAllMocks();
    const count = Object.keys(usePlaybackPositionStore.getState().positions).length;
    expect(count).toBeLessThanOrEqual(100);
  });
});

describe("playback-position-store getPosition", () => {
  it("returns null for a non-existent entry", () => {
    expect(usePlaybackPositionStore.getState().getPosition("twitch", "nope")).toBeNull();
  });
});

describe("playback-position-store removePosition", () => {
  it("removes a saved position", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 60, 3600);
    usePlaybackPositionStore.getState().removePosition("kick", "v1");
    expect(usePlaybackPositionStore.getState().getPosition("kick", "v1")).toBeNull();
  });

  it("is a no-op when the key does not exist", () => {
    usePlaybackPositionStore.getState().removePosition("kick", "nope");
    expect(Object.keys(usePlaybackPositionStore.getState().positions)).toHaveLength(0);
  });
});

describe("playback-position-store clearAll", () => {
  it("removes every position", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "v1", 60, 3600);
    usePlaybackPositionStore.getState().savePosition("twitch", "v2", 120, 7200);
    usePlaybackPositionStore.getState().clearAll();
    expect(usePlaybackPositionStore.getState().positions).toEqual({});
  });
});

describe("playback-position-store getRecentVideos", () => {
  it("returns entries sorted by lastUpdated descending", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    usePlaybackPositionStore.getState().savePosition("kick", "old", 60, 3600);
    vi.spyOn(Date, "now").mockReturnValue(2000);
    usePlaybackPositionStore.getState().savePosition("kick", "new", 90, 3600);
    vi.restoreAllMocks();

    const recent = usePlaybackPositionStore.getState().getRecentVideos();
    expect(recent[0].videoId).toBe("new");
    expect(recent[1].videoId).toBe("old");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1000 + i);
      usePlaybackPositionStore.getState().savePosition("kick", `v${i}`, 60, 3600);
    }
    vi.restoreAllMocks();
    expect(usePlaybackPositionStore.getState().getRecentVideos(3)).toHaveLength(3);
  });

  it("defaults to 10 items", () => {
    for (let i = 0; i < 15; i++) {
      vi.spyOn(Date, "now").mockReturnValue(1000 + i);
      usePlaybackPositionStore.getState().savePosition("kick", `v${i}`, 60, 3600);
    }
    vi.restoreAllMocks();
    expect(usePlaybackPositionStore.getState().getRecentVideos()).toHaveLength(10);
  });
});
