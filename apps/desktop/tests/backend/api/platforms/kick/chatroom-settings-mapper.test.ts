import { describe, expect, it } from "vitest";

import { mapKickChatroomToSettings } from "@/backend/api/platforms/kick/endpoints/channel-endpoints";

describe("mapKickChatroomToSettings", () => {
  it("returns undefined for null / non-object input", () => {
    expect(mapKickChatroomToSettings(null)).toBeUndefined();
    expect(mapKickChatroomToSettings(undefined)).toBeUndefined();
    expect(mapKickChatroomToSettings("not an object")).toBeUndefined();
    expect(mapKickChatroomToSettings(42)).toBeUndefined();
  });

  it("maps a fully-enabled v2 chatroom block to normalized shape", () => {
    const result = mapKickChatroomToSettings({
      id: 999,
      followers_mode: true,
      following_min_duration: 10,
      subscribers_mode: true,
      emotes_mode: true,
      slow_mode: true,
      message_interval: 30,
    });
    expect(result).toEqual({
      slowMode: { enabled: true, interval: 30 },
      followersMode: { enabled: true, minDuration: 10 },
      subscribersMode: { enabled: true },
      emoteOnlyMode: { enabled: true },
    });
  });

  it("maps a fully-disabled block to all-false enabled flags", () => {
    const result = mapKickChatroomToSettings({
      id: 999,
      followers_mode: false,
      following_min_duration: 5, // leftover value when disabled — must NOT surface
      subscribers_mode: false,
      emotes_mode: false,
      slow_mode: false,
      message_interval: 10, // leftover value — must NOT surface
    });
    expect(result).toEqual({
      slowMode: { enabled: false, interval: null },
      followersMode: { enabled: false, minDuration: null },
      subscribersMode: { enabled: false },
      emoteOnlyMode: { enabled: false },
    });
  });

  it("treats missing duration fields as null when mode is enabled", () => {
    const result = mapKickChatroomToSettings({
      followers_mode: true,
      slow_mode: true,
      subscribers_mode: false,
      emotes_mode: false,
    });
    expect(result?.followersMode).toEqual({ enabled: true, minDuration: null });
    expect(result?.slowMode).toEqual({ enabled: true, interval: null });
  });

  it("does NOT populate accountAge (only delivered via WS, not initial fetch)", () => {
    const result = mapKickChatroomToSettings({
      followers_mode: false,
      subscribers_mode: false,
      emotes_mode: false,
      slow_mode: false,
    });
    expect(result?.accountAge).toBeUndefined();
  });

  it("treats non-boolean mode flags as false (defensive)", () => {
    const result = mapKickChatroomToSettings({
      followers_mode: "yes", // not strictly true
      subscribers_mode: 1, // not strictly true
      slow_mode: null,
      emotes_mode: undefined,
    });
    expect(result?.followersMode.enabled).toBe(false);
    expect(result?.subscribersMode.enabled).toBe(false);
    expect(result?.slowMode.enabled).toBe(false);
    expect(result?.emoteOnlyMode.enabled).toBe(false);
  });
});
