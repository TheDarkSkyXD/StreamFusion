import { describe, expect, it } from "vitest";

import { chatroomUpdatedEventToPatch } from "@/backend/services/chat/kick-roomstate";

// Guards: Kick chatroom-updated event → state patch — each sub-mode's `{enabled, min_duration | message_interval}` shape, including the "stale min_duration when disabled" edge case (must produce null, not the stale number). Parallel of twitch-roomstate but for Kick's WebSocket event format.

describe("chatroomUpdatedEventToPatch", () => {
  it("followers_mode enabled with min_duration → followersOnly: 10 (minutes)", () => {
    expect(
      chatroomUpdatedEventToPatch({
        followers_mode: { enabled: true, min_duration: 10 },
      }),
    ).toEqual({ followersOnly: 10 });
  });

  it("followers_mode disabled → followersOnly: null (regardless of stale min_duration)", () => {
    expect(
      chatroomUpdatedEventToPatch({
        followers_mode: { enabled: false, min_duration: 10 },
      }),
    ).toEqual({ followersOnly: null });
  });

  it("slow_mode enabled with message_interval → slowMode: 30 (seconds)", () => {
    expect(
      chatroomUpdatedEventToPatch({
        slow_mode: { enabled: true, message_interval: 30 },
      }),
    ).toEqual({ slowMode: 30 });
  });

  it("slow_mode disabled → slowMode: null", () => {
    expect(
      chatroomUpdatedEventToPatch({
        slow_mode: { enabled: false },
      }),
    ).toEqual({ slowMode: null });
  });

  it("subscribers_mode enabled → subscribersOnly: true", () => {
    expect(
      chatroomUpdatedEventToPatch({ subscribers_mode: { enabled: true } }),
    ).toEqual({ subscribersOnly: true });
  });

  it("emotes_mode enabled → emoteOnly: true", () => {
    expect(
      chatroomUpdatedEventToPatch({ emotes_mode: { enabled: true } }),
    ).toEqual({ emoteOnly: true });
  });

  it("account_age enabled with min_duration → accountAge: 5 (minutes)", () => {
    expect(
      chatroomUpdatedEventToPatch({
        account_age: { enabled: true, min_duration: 5 },
      }),
    ).toEqual({ accountAge: 5 });
  });

  it("account_age disabled → accountAge: null", () => {
    expect(
      chatroomUpdatedEventToPatch({
        account_age: { enabled: false, min_duration: 5 },
      }),
    ).toEqual({ accountAge: null });
  });

  it("combined payload → combined patch with all fields", () => {
    expect(
      chatroomUpdatedEventToPatch({
        slow_mode: { enabled: true, message_interval: 30 },
        followers_mode: { enabled: true, min_duration: 10 },
        subscribers_mode: { enabled: true },
        emotes_mode: { enabled: false },
        account_age: { enabled: true, min_duration: 5 },
      }),
    ).toEqual({
      slowMode: 30,
      followersOnly: 10,
      subscribersOnly: true,
      emoteOnly: false,
      accountAge: 5,
    });
  });

  it("empty payload → empty patch", () => {
    expect(chatroomUpdatedEventToPatch({})).toEqual({});
  });

  it("partial payload (only one mode changed) only patches that mode", () => {
    expect(
      chatroomUpdatedEventToPatch({
        followers_mode: { enabled: true, min_duration: 5 },
      }),
    ).toEqual({ followersOnly: 5 });
  });
});
