import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useChatRoomState } from "@/hooks/useChatRoomState";
import { useRoomStateStore } from "@/store/room-state-store";

beforeEach(() => {
  useRoomStateStore.setState({ entries: {} });
});

describe("useChatRoomState", () => {
  it("returns the default room-state when no entry exists for the (platform, channelId) pair", () => {
    const { result } = renderHook(() => useChatRoomState("twitch", "c1"));
    expect(result.current).toEqual({
      slowMode: null,
      followersOnly: null,
      subscribersOnly: false,
      emoteOnly: false,
      uniqueChat: false,
      shieldMode: false,
    });
  });

  it("returns the default room-state when channelId is null", () => {
    const { result } = renderHook(() => useChatRoomState("twitch", null));
    expect(result.current.slowMode).toBeNull();
    expect(result.current.followersOnly).toBeNull();
    expect(result.current.shieldMode).toBe(false);
  });

  it("re-renders with the new value when updateRoomState patches the entry", () => {
    const { result } = renderHook(() => useChatRoomState("twitch", "c1"));
    expect(result.current.slowMode).toBeNull();

    act(() => {
      useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    });
    expect(result.current.slowMode).toBe(30);

    act(() => {
      useRoomStateStore.getState().updateRoomState("twitch", "c1", {
        shieldMode: true,
        uniqueChat: true,
      });
    });
    expect(result.current.slowMode).toBe(30); // preserved from earlier patch
    expect(result.current.shieldMode).toBe(true);
    expect(result.current.uniqueChat).toBe(true);
  });

  it("isolates state by (platform, channelId) — a write to one key does not leak to another", () => {
    act(() => {
      useRoomStateStore
        .getState()
        .updateRoomState("twitch", "c1", { slowMode: 30 });
    });
    const { result: c1 } = renderHook(() => useChatRoomState("twitch", "c1"));
    const { result: c2 } = renderHook(() => useChatRoomState("twitch", "c2"));
    const { result: kickC1 } = renderHook(() => useChatRoomState("kick", "c1"));
    expect(c1.current.slowMode).toBe(30);
    expect(c2.current.slowMode).toBeNull();
    expect(kickC1.current.slowMode).toBeNull();
  });

  it("switching channelId switches which entry is read", () => {
    act(() => {
      useRoomStateStore
        .getState()
        .updateRoomState("twitch", "c1", { emoteOnly: true });
      useRoomStateStore
        .getState()
        .updateRoomState("twitch", "c2", { emoteOnly: false, slowMode: 60 });
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatRoomState("twitch", id),
      { initialProps: { id: "c1" } },
    );
    expect(result.current.emoteOnly).toBe(true);
    expect(result.current.slowMode).toBeNull();

    rerender({ id: "c2" });
    expect(result.current.emoteOnly).toBe(false);
    expect(result.current.slowMode).toBe(60);
  });

  it("resetRoomState removes a channel's entry", () => {
    act(() => {
      useRoomStateStore
        .getState()
        .updateRoomState("twitch", "c1", { slowMode: 30, shieldMode: true });
    });
    const { result } = renderHook(() => useChatRoomState("twitch", "c1"));
    expect(result.current.slowMode).toBe(30);

    act(() => {
      useRoomStateStore.getState().resetRoomState("twitch", "c1");
    });
    expect(result.current.slowMode).toBeNull();
    expect(result.current.shieldMode).toBe(false);
  });
});
