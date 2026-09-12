import assert from "node:assert/strict";
import test from "node:test";

import {
  findGuestFollow,
  guestFollowKey,
  parseGuestFollowWrite,
} from "@streamfusion/core/follows";

const followedAt = "2026-09-11T12:00:00.000Z";

function follow(overrides = {}) {
  return {
    platform: "twitch",
    channelId: "71092938",
    channelLogin: "pokimane",
    displayName: "Pokimane",
    followedAt,
    ...overrides,
  };
}

test("parseGuestFollowWrite lowercases login and keeps a valid Guest Follow", () => {
  const parsed = parseGuestFollowWrite(
    follow({ channelLogin: "PokiMane", displayName: "  Pokimane  " }),
  );
  assert.deepEqual(parsed, follow({ channelLogin: "pokimane" }));
  assert.equal(guestFollowKey(parsed), "twitch:71092938");
});

test("parseGuestFollowWrite rejects extra fields and empty identity", () => {
  assert.equal(parseGuestFollowWrite(follow({ avatarUrl: "https://x" })), null);
  assert.equal(parseGuestFollowWrite(follow({ channelId: "" })), null);
  assert.equal(
    parseGuestFollowWrite(follow({ channelLogin: "Poki Mane" })),
    null,
  );
  assert.equal(parseGuestFollowWrite(follow({ platform: "youtube" })), null);
  assert.equal(
    parseGuestFollowWrite(follow({ followedAt: "2026-09-11T12:00:00Z" })),
    null,
  );
});

test("findGuestFollow matches platform plus id or login without mixing rows", () => {
  const twitch = parseGuestFollowWrite(follow());
  const kick = parseGuestFollowWrite(
    follow({
      platform: "kick",
      channelId: "411439",
      channelLogin: "xqc",
      displayName: "xQc",
    }),
  );
  assert.ok(twitch && kick);
  const follows = [twitch, kick];
  assert.equal(
    findGuestFollow(follows, { platform: "twitch", channelId: "71092938" }),
    twitch,
  );
  assert.equal(
    findGuestFollow(follows, { platform: "kick", channelLogin: "XQC" }),
    kick,
  );
  assert.equal(
    findGuestFollow(follows, { platform: "twitch", channelLogin: "xqc" }),
    undefined,
  );
});
