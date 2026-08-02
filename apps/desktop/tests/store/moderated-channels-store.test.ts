import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModeratedChannelsStore } from "@/store/moderated-channels-store";
import { installElectronAPIMock } from "../test-utils";

const getModeratedChannelsMock = vi.fn();

function freshStore() {
  // Reset between tests by calling clear() — store is a module singleton.
  act(() => {
    useModeratedChannelsStore.getState().clear();
  });
}

beforeEach(() => {
  freshStore();
  const api = installElectronAPIMock();
  getModeratedChannelsMock.mockReset();
  getModeratedChannelsMock.mockResolvedValue({ ok: true, data: [] });
  api.twitch.execute = getModeratedChannelsMock;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useModeratedChannelsStore", () => {
  it("hydrates through main without receiving Twitch credentials", async () => {
    const api = installElectronAPIMock();
    api.twitch.execute = vi.fn().mockResolvedValue({
      ok: true,
      data: [{ broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" }],
    });

    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });

    expect(api.twitch.execute).toHaveBeenCalledWith({
      operation: "get-moderated-channels",
      userId: "me",
    });
    expect(JSON.stringify(vi.mocked(api.twitch.execute).mock.calls)).not.toMatch(/token|client.?id/i);
  });

  it("records a failed authority lookup without replacing it with a verified empty result", async () => {
    getModeratedChannelsMock.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "Sign in" },
    });

    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });

    expect(useModeratedChannelsStore.getState().twitchAuthority).toMatchObject({
      state: "failed",
      reason: "authorization",
    });
    expect(useModeratedChannelsStore.getState().hydratedAt).toBeNull();
  });

  it("starts empty and stale", () => {
    const state = useModeratedChannelsStore.getState();
    expect(state.twitchModeratedChannelIds.size).toBe(0);
    expect(state.kickModeratedChannelSlugs.size).toBe(0);
    expect(state.hydratedAt).toBeNull();
    expect(state.isStale()).toBe(true);
  });

  it("hydrate populates the Set with returned broadcaster ids", async () => {
    getModeratedChannelsMock.mockResolvedValue({ ok: true, data: [
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
      { broadcaster_id: "222", broadcaster_login: "b", broadcaster_name: "B" },
    ] });

    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });

    const state = useModeratedChannelsStore.getState();
    expect(Array.from(state.twitchModeratedChannelIds).sort()).toEqual(["111", "222"]);
    expect(state.hydratedAt).not.toBeNull();
    expect(state.isStale()).toBe(false);
  });

  it("dedupes concurrent hydrate calls", async () => {
    let resolve: (v: { ok: true; data: never[] }) => void = () => {};
    const pending = new Promise<{ ok: true; data: never[] }>((r) => {
      resolve = r;
    });
    getModeratedChannelsMock.mockReturnValueOnce(pending);

    const first = useModeratedChannelsStore.getState().hydrate("me");
    const second = useModeratedChannelsStore.getState().hydrate("me");

    expect(getModeratedChannelsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ok: true, data: [] });
      await Promise.all([first, second]);
    });

    expect(getModeratedChannelsMock).toHaveBeenCalledTimes(1);
  });

  it("preserves prior cache when hydrate throws", async () => {
    getModeratedChannelsMock.mockResolvedValueOnce({ ok: true, data: [
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ] });
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);

    getModeratedChannelsMock.mockRejectedValueOnce(new Error("network blip"));
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);
    expect(useModeratedChannelsStore.getState().hydrating).toBe(false);
  });

  it("applies live Twitch moderator grants and removals for one channel", () => {
    act(() => {
      useModeratedChannelsStore.getState().setTwitchChannelModState("111", true);
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);

    act(() => {
      useModeratedChannelsStore.getState().setTwitchChannelModState("111", false);
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(false);
  });

  it("applies live Kick moderator grants and removals for one channel slug", () => {
    act(() => {
      useModeratedChannelsStore.getState().setKickChannelModState("Ac7ionMan", true);
    });

    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("ac7ionman")).toBe(
      true
    );

    act(() => {
      useModeratedChannelsStore.getState().setKickChannelModState("ac7ionman", false);
    });

    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("ac7ionman")).toBe(
      false
    );
  });

  it("isStale returns true after 5 minutes elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00Z"));
    getModeratedChannelsMock.mockResolvedValue({ ok: true, data: [
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ] });
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
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
    getModeratedChannelsMock.mockResolvedValue({ ok: true, data: [
      { broadcaster_id: "111", broadcaster_login: "a", broadcaster_name: "A" },
    ] });
    await act(async () => {
      await useModeratedChannelsStore.getState().hydrate("me");
    });
    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.size).toBe(1);

    act(() => {
      useModeratedChannelsStore.getState().clear();
    });

    const state = useModeratedChannelsStore.getState();
    expect(state.twitchModeratedChannelIds.size).toBe(0);
    expect(state.kickModeratedChannelSlugs.size).toBe(0);
    expect(state.hydratedAt).toBeNull();
    expect(state.isStale()).toBe(true);
  });

  it("clears Twitch and Kick moderator state independently", () => {
    act(() => {
      useModeratedChannelsStore.getState().setTwitchChannelModState("111", true);
      useModeratedChannelsStore.getState().setKickChannelModState("ac7ionman", true);
    });

    act(() => {
      useModeratedChannelsStore.getState().clearTwitch();
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(false);
    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("ac7ionman")).toBe(
      true
    );

    act(() => {
      useModeratedChannelsStore.getState().setTwitchChannelModState("111", true);
      useModeratedChannelsStore.getState().clearKick();
    });

    expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("111")).toBe(true);
    expect(useModeratedChannelsStore.getState().kickModeratedChannelSlugs.has("ac7ionman")).toBe(
      false
    );
  });
});
