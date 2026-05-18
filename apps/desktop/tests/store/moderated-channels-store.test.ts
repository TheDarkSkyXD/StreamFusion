import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/api/platforms/twitch/twitch-helix-moderation", () => ({
  getModeratedChannels: vi.fn(),
}));

import { getModeratedChannels } from "@/backend/api/platforms/twitch/twitch-helix-moderation";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

const getModeratedChannelsMock = vi.mocked(getModeratedChannels);

function freshStore() {
  // Reset between tests by calling clear() — store is a module singleton.
  act(() => {
    useModeratedChannelsStore.getState().clear();
  });
}

beforeEach(() => {
  freshStore();
  getModeratedChannelsMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useModeratedChannelsStore", () => {
  it("starts empty and stale", () => {
    const state = useModeratedChannelsStore.getState();
    expect(state.twitchModeratedChannelIds.size).toBe(0);
    expect(state.hydratedAt).toBeNull();
    expect(state.isStale()).toBe(true);
  });

  it("hydrate populates the Set with returned broadcaster ids", async () => {
    getModeratedChannelsMock.mockResolvedValue([
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
      { broadcaster_id: "222", broadcaster_login: "b", broadcaster_name: "B" },
    ]);

    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    });

    const state = useModeratedChannelsStore.getState();
    expect(Array.from(state.twitchModeratedChannelIds).sort()).toEqual(["111", "222"]);
    expect(state.hydratedAt).not.toBeNull();
    expect(state.isStale()).toBe(false);
  });

  it("dedupes concurrent hydrate calls", async () => {
    let resolve: (v: never[]) => void = () => {};
    const pending = new Promise<never[]>((r) => {
      resolve = r;
    });
    getModeratedChannelsMock.mockReturnValueOnce(pending);

    const first = useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    const second = useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");

    expect(getModeratedChannelsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve([]);
      await Promise.all([first, second]);
    });

    expect(getModeratedChannelsMock).toHaveBeenCalledTimes(1);
  });

  it("preserves prior cache when hydrate throws", async () => {
    getModeratedChannelsMock.mockResolvedValueOnce([
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ]);
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);

    getModeratedChannelsMock.mockRejectedValueOnce(new Error("network blip"));
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);
    expect(useModeratedChannelsStore.getState().hydrating).toBe(false);
  });

  it("isStale returns true after 5 minutes elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00Z"));
    getModeratedChannelsMock.mockResolvedValue([
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ]);
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    });
    expect(useModeratedChannelsStore.getState().isStale()).toBe(false);

    // Advance just under 5 minutes
    vi.setSystemTime(new Date("2026-05-18T00:04:59Z"));
    expect(useModeratedChannelsStore.getState().isStale()).toBe(false);

    // Advance just past 5 minutes
    vi.setSystemTime(new Date("2026-05-18T00:05:01Z"));
    expect(useModeratedChannelsStore.getState().isStale()).toBe(true);
  });

  it("clear resets the store to its empty initial state", async () => {
    getModeratedChannelsMock.mockResolvedValue([
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ]);
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me", "tok", "cid");
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.size).toBe(1);

    act(() => {
      useModeratedChannelsStore.getState().clear();
    });

    const state = useModeratedChannelsStore.getState();
    expect(state.twitchModeratedChannelIds.size).toBe(0);
    expect(state.hydratedAt).toBeNull();
    expect(state.isStale()).toBe(true);
  });
});
