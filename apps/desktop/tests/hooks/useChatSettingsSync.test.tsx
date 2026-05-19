/**
 * useChatSettingsSync tests (U6 merge seam).
 *
 * Covers:
 *   - chatSettingsToPatch pure translator for Twitch + Kick, including the
 *     stale-leftover protection rule (enable flag MUST be read before its
 *     companion duration field).
 *   - Module-scoped in-flight Set dedup and channel-switch discard.
 *   - Hook lifecycle: initial fetch (happy + failure), channel-change
 *     re-mount, same-key remount (StrictMode), WS event filtering, reconnect
 *     re-fetch (skipping the first connect).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSettingsResult } from "@/backend/api/platforms/twitch/twitch-helix-chat-settings";
import type { KickChatroomSettings } from "@/backend/api/unified/platform-types";
import type {
  ChatConnectionStatus,
  RoomStatePatchEvent,
} from "@/shared/chat-types";
import { useRoomStateStore } from "@/store/room-state-store";

// ---------------------------------------------------------------------------
// Mocks — Twitch Helix getChatSettings + chat service singletons.
// All stub state is declared inside vi.hoisted so the vi.mock factories
// (which are themselves hoisted) can reference it without a TDZ error.
// ---------------------------------------------------------------------------

const { getChatSettingsMock, twitchStub, kickStub } = vi.hoisted(() => {
  type AnyListener = (...args: unknown[]) => void;
  class StubService {
    private listeners = new Map<string, Set<AnyListener>>();
    on(event: string, fn: AnyListener) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
    }
    off(event: string, fn: AnyListener) {
      this.listeners.get(event)?.delete(fn);
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((fn) => fn(...args));
    }
    listenerCount(event: string): number {
      return this.listeners.get(event)?.size ?? 0;
    }
  }
  return {
    getChatSettingsMock: vi.fn(),
    twitchStub: new StubService(),
    kickStub: new StubService(),
  };
});

vi.mock("@/backend/api/platforms/twitch/twitch-helix-chat-settings", () => ({
  getChatSettings: (broadcasterId: string, signal?: AbortSignal) =>
    getChatSettingsMock(broadcasterId, signal),
}));

vi.mock("@/backend/services/chat/twitch-chat", () => ({
  twitchChatService: twitchStub,
}));
vi.mock("@/backend/services/chat/kick-chat", () => ({
  kickChatService: kickStub,
}));

// ---------------------------------------------------------------------------
// Mocks — window.electronAPI for Kick channels.getByUsername
// ---------------------------------------------------------------------------

const getByUsernameMock = vi.fn<
  (args: { platform: string; username: string }) => Promise<{
    success?: boolean;
    data?: unknown;
    error?: string;
  }>
>();

beforeEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: jest-style window install
  const w = (globalThis as any).window ?? ((globalThis as any).window = {});
  w.electronAPI = {
    channels: { getByUsername: getByUsernameMock },
    auth: {
      // Hook calls getValidTwitchToken() before getChatSettings; returning a
      // stable string keeps the Bearer-auth path happy without exercising the
      // refresh flow (the wrapper covers that elsewhere).
      getValidTwitchToken: vi.fn().mockResolvedValue("tok"),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports under test — after vi.mock so the mocks take effect
// ---------------------------------------------------------------------------

import {
  __getProvenance,
  __isInFlight,
  __resetInFlight,
  __resetProvenance,
  chatSettingsToPatch,
  useChatSettingsSync,
} from "@/hooks/useChatSettingsSync";

beforeEach(() => {
  useRoomStateStore.setState({ entries: {} });
  __resetInFlight();
  __resetProvenance();
  getChatSettingsMock.mockReset();
  getByUsernameMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// chatSettingsToPatch — Twitch
// ===========================================================================

describe("chatSettingsToPatch (Twitch)", () => {
  it("follower_mode enabled with follower_mode_duration: 10 → followersOnly: 10 (minutes)", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        follower_mode: true,
        follower_mode_duration: 10,
      }),
    ).toEqual({ followersOnly: 10 });
  });

  it("STALE-LEFTOVER: follower_mode false + duration 10 → followersOnly: null", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        follower_mode: false,
        follower_mode_duration: 10,
      }),
    ).toEqual({ followersOnly: null });
  });

  it("STALE-LEFTOVER: slow_mode false + slow_mode_wait_time 30 → slowMode: null", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        slow_mode: false,
        slow_mode_wait_time: 30,
      }),
    ).toEqual({ slowMode: null });
  });

  it("slow_mode enabled with wait time → slowMode: 30 (seconds)", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        slow_mode: true,
        slow_mode_wait_time: 30,
      }),
    ).toEqual({ slowMode: 30 });
  });

  it("subscriber_mode, emote_mode, unique_chat_mode flow through", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        subscriber_mode: true,
        emote_mode: false,
        unique_chat_mode: true,
      }),
    ).toEqual({
      subscribersOnly: true,
      emoteOnly: false,
      uniqueChat: true,
    });
  });

  it("absent fields produce empty patch (no spurious nulls)", () => {
    expect(chatSettingsToPatch("twitch", { broadcaster_id: "1" })).toEqual({});
  });

  it("follower_mode true with absent duration → followersOnly: 0", () => {
    expect(
      chatSettingsToPatch("twitch", {
        broadcaster_id: "1",
        follower_mode: true,
      }),
    ).toEqual({ followersOnly: 0 });
  });
});

// ===========================================================================
// chatSettingsToPatch — Kick
// ===========================================================================

describe("chatSettingsToPatch (Kick)", () => {
  const full: KickChatroomSettings = {
    slowMode: { enabled: true, interval: 30 },
    followersMode: { enabled: true, minDuration: 10 },
    subscribersMode: { enabled: false },
    emoteOnlyMode: { enabled: false },
    accountAge: { enabled: true, minDuration: 5 },
  };

  it("all modes → patch with all fields in correct units", () => {
    expect(chatSettingsToPatch("kick", full)).toEqual({
      slowMode: 30,
      followersOnly: 10,
      subscribersOnly: false,
      emoteOnly: false,
      accountAge: 5,
    });
  });

  it("STALE-LEFTOVER: followersMode.enabled false → followersOnly: null", () => {
    expect(
      chatSettingsToPatch("kick", {
        slowMode: { enabled: false, interval: null },
        followersMode: { enabled: false, minDuration: 10 },
        subscribersMode: { enabled: false },
        emoteOnlyMode: { enabled: false },
      }),
    ).toEqual({
      slowMode: null,
      followersOnly: null,
      subscribersOnly: false,
      emoteOnly: false,
    });
  });

  it("accountAge omitted (initial v2 fetch case) → patch omits accountAge", () => {
    const { accountAge, ...settings } = full;
    const patch = chatSettingsToPatch("kick", settings as KickChatroomSettings);
    expect("accountAge" in patch).toBe(false);
  });
});

// ===========================================================================
// In-flight Set / hook lifecycle
// ===========================================================================

describe("useChatSettingsSync — initial fetch", () => {
  it("fetches Twitch chat settings and writes the translated patch on success", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123", slow_mode: true, slow_mode_wait_time: 30 },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(useRoomStateStore.getState().entries["twitch:123"]?.slowMode).toBe(30);
    });
    expect(__getProvenance("twitch:123")).toBe("fetch");
  });

  it("fetch failure does NOT write to store and does not throw", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getChatSettingsMock.mockRejectedValueOnce(new Error("network down"));

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(getChatSettingsMock).toHaveBeenCalled();
    });
    // Store stays empty; provenance never recorded a 'fetch' for this key.
    expect(useRoomStateStore.getState().entries["twitch:123"]).toBeUndefined();
    expect(__getProvenance("twitch:123")).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("non-ok Helix response (401/etc) does NOT write to store", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: false,
      kind: "unauthorized",
      message: "expired",
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(getChatSettingsMock).toHaveBeenCalled();
    });
    expect(useRoomStateStore.getState().entries["twitch:123"]).toBeUndefined();
  });

  it("skipped entirely when channelId is null", async () => {
    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: null }),
    );
    // Give microtasks a chance.
    await new Promise((r) => setTimeout(r, 0));
    expect(getChatSettingsMock).not.toHaveBeenCalled();
  });

  it("Kick reads chatroomSettings off the cached UnifiedChannel via IPC", async () => {
    getByUsernameMock.mockResolvedValueOnce({
      success: true,
      data: {
        chatroomSettings: {
          slowMode: { enabled: true, interval: 60 },
          followersMode: { enabled: false, minDuration: null },
          subscribersMode: { enabled: false },
          emoteOnlyMode: { enabled: false },
        } satisfies KickChatroomSettings,
      },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "kick", channel: "ac7ionman", channelId: "999" }),
    );

    await waitFor(() => {
      expect(useRoomStateStore.getState().entries["kick:999"]?.slowMode).toBe(60);
    });
  });
});

describe("useChatSettingsSync — in-flight dedup + StrictMode", () => {
  it("same-key concurrent mount-then-unmount does not double-fetch on second mount", async () => {
    // Slow-resolving first call so the in-flight Set has time to gate.
    let resolveFirst: (v: ChatSettingsResult) => void = () => undefined;
    getChatSettingsMock.mockImplementationOnce(
      () =>
        new Promise<ChatSettingsResult>((res) => {
          resolveFirst = res;
        }),
    );

    const { unmount } = renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );
    expect(__isInFlight("twitch:123")).toBe(true);

    unmount();
    // After unmount, controller aborts and the eager cleanup removes the key
    // so a same-key remount can fetch.
    expect(__isInFlight("twitch:123")).toBe(false);

    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123", emote_mode: true },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(useRoomStateStore.getState().entries["twitch:123"]?.emoteOnly).toBe(true);
    });

    // Resolve the first (aborted) call AFTER the second succeeded; it must NOT
    // overwrite the second mount's clean write.
    resolveFirst({
      ok: true,
      payload: { broadcaster_id: "123", emote_mode: false },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(useRoomStateStore.getState().entries["twitch:123"]?.emoteOnly).toBe(true);
  });

  it("channel-switch: A's pending request does NOT overwrite B's write", async () => {
    let resolveA: (v: ChatSettingsResult) => void = () => undefined;
    getChatSettingsMock.mockImplementationOnce(
      () =>
        new Promise<ChatSettingsResult>((res) => {
          resolveA = res;
        }),
    );

    const { rerender } = renderHook(
      ({ channelId }: { channelId: string }) =>
        useChatSettingsSync({ platform: "twitch", channel: "a", channelId }),
      { initialProps: { channelId: "A" } },
    );

    // Switch to B before A resolves.
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "B", slow_mode: true, slow_mode_wait_time: 90 },
    });
    rerender({ channelId: "B" });

    await waitFor(() => {
      expect(useRoomStateStore.getState().entries["twitch:B"]?.slowMode).toBe(90);
    });

    // A's stale response now lands — it must not write to either key.
    resolveA({
      ok: true,
      payload: { broadcaster_id: "A", slow_mode: true, slow_mode_wait_time: 5 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(useRoomStateStore.getState().entries["twitch:A"]).toBeUndefined();
    expect(useRoomStateStore.getState().entries["twitch:B"]?.slowMode).toBe(90);
  });
});

// ===========================================================================
// WS event wiring
// ===========================================================================

describe("useChatSettingsSync — roomState WS event", () => {
  it("WS event for the active channel writes patch into store", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123" },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(twitchStub.listenerCount("roomState")).toBe(1);
    });

    const event: RoomStatePatchEvent = {
      platform: "twitch",
      channel: "ninja",
      channelId: "123",
      patch: { uniqueChat: true, slowMode: 60 },
      reason: "ws",
    };

    act(() => {
      twitchStub.emit("roomState", event);
    });

    expect(useRoomStateStore.getState().entries["twitch:123"]?.uniqueChat).toBe(true);
    expect(useRoomStateStore.getState().entries["twitch:123"]?.slowMode).toBe(60);
    expect(__getProvenance("twitch:123")).toBe("ws");
  });

  it("WS event for a DIFFERENT channel does NOT write", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123" },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(twitchStub.listenerCount("roomState")).toBe(1);
    });

    act(() => {
      twitchStub.emit("roomState", {
        platform: "twitch",
        channel: "shroud",
        channelId: "456",
        patch: { slowMode: 999 },
        reason: "ws",
      } satisfies RoomStatePatchEvent);
    });

    expect(useRoomStateStore.getState().entries["twitch:456"]).toBeUndefined();
    expect(useRoomStateStore.getState().entries["twitch:123"]?.slowMode).toBeFalsy();
  });

  it("unmount removes the WS listener", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123" },
    });
    const { unmount } = renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );
    await waitFor(() => {
      expect(twitchStub.listenerCount("roomState")).toBe(1);
    });
    unmount();
    expect(twitchStub.listenerCount("roomState")).toBe(0);
    expect(twitchStub.listenerCount("connectionStateChange")).toBe(0);
  });
});

// ===========================================================================
// Reconnect re-fetch
// ===========================================================================

describe("useChatSettingsSync — reconnect re-fetch", () => {
  it("first `connected` does NOT trigger a second fetch", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123", slow_mode: true, slow_mode_wait_time: 10 },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(twitchStub.listenerCount("connectionStateChange")).toBe(1);
      expect(getChatSettingsMock).toHaveBeenCalledTimes(1);
    });

    // Simulate the first `connected` after the mount-path fetch.
    act(() => {
      twitchStub.emit("connectionStateChange", {
        platform: "twitch",
        state: "connected",
        channels: ["ninja"],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(getChatSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("subsequent `connected` (reconnect) DOES re-fetch and re-seed the store", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123", slow_mode: true, slow_mode_wait_time: 10 },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(useRoomStateStore.getState().entries["twitch:123"]?.slowMode).toBe(10);
    });

    // First `connected` is the initial — does not refetch.
    act(() => {
      twitchStub.emit("connectionStateChange", {
        platform: "twitch",
        state: "connected",
        channels: ["ninja"],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
    });

    // Disconnect + reconnect: a second `connected` triggers re-fetch.
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123", slow_mode: false, slow_mode_wait_time: 10 },
    });
    act(() => {
      twitchStub.emit("connectionStateChange", {
        platform: "twitch",
        state: "disconnected",
        channels: [],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
      twitchStub.emit("connectionStateChange", {
        platform: "twitch",
        state: "connected",
        channels: ["ninja"],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
    });

    await waitFor(() => {
      expect(getChatSettingsMock).toHaveBeenCalledTimes(2);
      // Re-seed: stale-leftover guard means slow_mode: false → null even with
      // a leftover wait_time.
      expect(useRoomStateStore.getState().entries["twitch:123"]?.slowMode).toBeNull();
    });
  });

  it("`connectionStateChange` for a DIFFERENT platform is ignored", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123" },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(getChatSettingsMock).toHaveBeenCalledTimes(1);
    });

    // First connected (initial) + a kick connectionState change (irrelevant).
    act(() => {
      twitchStub.emit("connectionStateChange", {
        platform: "twitch",
        state: "connected",
        channels: ["ninja"],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
      twitchStub.emit("connectionStateChange", {
        platform: "kick",
        state: "connected",
        channels: [],
        isAuthenticated: false,
      } satisfies ChatConnectionStatus);
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(getChatSettingsMock).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Optimistic / WS converge (last-write-wins)
// ===========================================================================

describe("useChatSettingsSync — converge with optimistic writes", () => {
  it("optimistic write then WS event → WS value wins; provenance is 'ws'", async () => {
    getChatSettingsMock.mockResolvedValueOnce({
      ok: true,
      payload: { broadcaster_id: "123" },
    });

    renderHook(() =>
      useChatSettingsSync({ platform: "twitch", channel: "ninja", channelId: "123" }),
    );

    await waitFor(() => {
      expect(twitchStub.listenerCount("roomState")).toBe(1);
    });

    // Optimistic mod-strip writes uniqueChat: true (sites outside this hook).
    act(() => {
      useRoomStateStore.getState().updateRoomState("twitch", "123", {
        uniqueChat: true,
      });
    });
    expect(useRoomStateStore.getState().entries["twitch:123"]?.uniqueChat).toBe(true);

    // Live WS event reports uniqueChat: false → the WS value wins.
    act(() => {
      twitchStub.emit("roomState", {
        platform: "twitch",
        channel: "ninja",
        channelId: "123",
        patch: { uniqueChat: false },
        reason: "ws",
      } satisfies RoomStatePatchEvent);
    });
    expect(useRoomStateStore.getState().entries["twitch:123"]?.uniqueChat).toBe(false);
    expect(__getProvenance("twitch:123")).toBe("ws");
  });
});
