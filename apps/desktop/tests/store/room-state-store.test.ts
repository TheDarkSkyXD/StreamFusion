import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ROOM_STATE, roomStateKey, useRoomStateStore } from "@/store/room-state-store";

beforeEach(() => {
  useRoomStateStore.setState({ entries: {} });
});

describe("room-state-store updateRoomState", () => {
  it("creates a new entry with defaults merged when none exists", () => {
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    const key = roomStateKey("twitch", "c1");
    const entry = useRoomStateStore.getState().entries[key];
    expect(entry).toEqual({ ...DEFAULT_ROOM_STATE, slowMode: 30 });
  });

  it("patches an existing entry without losing prior fields", () => {
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { emoteOnly: true });
    const key = roomStateKey("twitch", "c1");
    const entry = useRoomStateStore.getState().entries[key];
    expect(entry.slowMode).toBe(30);
    expect(entry.emoteOnly).toBe(true);
  });

  it("isolates entries by platform and channelId", () => {
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    useRoomStateStore.getState().updateRoomState("kick", "c1", { slowMode: 60 });
    const twitchKey = roomStateKey("twitch", "c1");
    const kickKey = roomStateKey("kick", "c1");
    expect(useRoomStateStore.getState().entries[twitchKey].slowMode).toBe(30);
    expect(useRoomStateStore.getState().entries[kickKey].slowMode).toBe(60);
  });
});

describe("room-state-store resetRoomState", () => {
  it("removes the entry for the given platform/channel", () => {
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    useRoomStateStore.getState().resetRoomState("twitch", "c1");
    const key = roomStateKey("twitch", "c1");
    expect(useRoomStateStore.getState().entries[key]).toBeUndefined();
  });

  it("is a no-op when the entry does not exist", () => {
    const before = useRoomStateStore.getState();
    useRoomStateStore.getState().resetRoomState("twitch", "nonexistent");
    expect(useRoomStateStore.getState()).toBe(before);
  });

  it("does not affect other entries", () => {
    useRoomStateStore.getState().updateRoomState("twitch", "c1", { slowMode: 30 });
    useRoomStateStore.getState().updateRoomState("twitch", "c2", { emoteOnly: true });
    useRoomStateStore.getState().resetRoomState("twitch", "c1");
    const c2Key = roomStateKey("twitch", "c2");
    expect(useRoomStateStore.getState().entries[c2Key].emoteOnly).toBe(true);
  });
});

describe("roomStateKey", () => {
  it("returns platform:channelId", () => {
    expect(roomStateKey("twitch", "abc")).toBe("twitch:abc");
    expect(roomStateKey("kick", "123")).toBe("kick:123");
  });
});
