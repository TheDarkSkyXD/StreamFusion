import { describe, expect, it } from "vitest";

import { roomStateTagsToPatch } from "@/backend/services/chat/twitch-roomstate";

describe("roomStateTagsToPatch", () => {
  it("followers-only '-1' → followersOnly: null (off)", () => {
    expect(roomStateTagsToPatch({ "followers-only": "-1" })).toEqual({
      followersOnly: null,
    });
  });

  it("followers-only false → followersOnly: null", () => {
    expect(roomStateTagsToPatch({ "followers-only": false })).toEqual({
      followersOnly: null,
    });
  });

  it("followers-only '0' → followersOnly: 0 (on, no minimum)", () => {
    expect(roomStateTagsToPatch({ "followers-only": "0" })).toEqual({
      followersOnly: 0,
    });
  });

  it("followers-only '10' → followersOnly: 10 (minutes)", () => {
    expect(roomStateTagsToPatch({ "followers-only": "10" })).toEqual({
      followersOnly: 10,
    });
  });

  it("slow '0' → slowMode: null (off)", () => {
    expect(roomStateTagsToPatch({ slow: "0" })).toEqual({ slowMode: null });
  });

  it("slow false → slowMode: null", () => {
    expect(roomStateTagsToPatch({ slow: false })).toEqual({ slowMode: null });
  });

  it("slow '120' → slowMode: 120 (seconds)", () => {
    expect(roomStateTagsToPatch({ slow: "120" })).toEqual({ slowMode: 120 });
  });

  it("r9k boolean → uniqueChat", () => {
    expect(roomStateTagsToPatch({ r9k: true })).toEqual({ uniqueChat: true });
    expect(roomStateTagsToPatch({ r9k: false })).toEqual({ uniqueChat: false });
  });

  it("emote-only boolean → emoteOnly", () => {
    expect(roomStateTagsToPatch({ "emote-only": true })).toEqual({
      emoteOnly: true,
    });
  });

  it("subs-only boolean → subscribersOnly", () => {
    expect(roomStateTagsToPatch({ "subs-only": true })).toEqual({
      subscribersOnly: true,
    });
  });

  it("combined tags → combined patch", () => {
    const out = roomStateTagsToPatch({
      "followers-only": "5",
      slow: "30",
      r9k: true,
      "emote-only": false,
      "subs-only": false,
    });
    expect(out).toEqual({
      followersOnly: 5,
      slowMode: 30,
      uniqueChat: true,
      emoteOnly: false,
      subscribersOnly: false,
    });
  });

  it("empty tags → empty patch (no fields set)", () => {
    expect(roomStateTagsToPatch({})).toEqual({});
  });

  it("only room-id present → empty patch (room-id is not a mode field)", () => {
    expect(roomStateTagsToPatch({ "room-id": "12345" })).toEqual({});
  });
});
