import assert from "node:assert/strict";
import test from "node:test";
import { createVerificationAccountSeed } from "./account-seed.mjs";

test("verification copies preferences without sharing rotating credentials", () => {
  const source = {
    preferences: { theme: "dark" },
    lastActiveTab: "home",
    windowBounds: { width: 1400, height: 900 },
    authTokens: { twitch: { encrypted: "one-use-refresh-credential" } },
    appTokens: { twitch: { encrypted: "app-credential" } },
    twitchUser: { id: "1" },
    kickUser: { id: "2" },
    twitchFollowWriteToken: { encrypted: "follow-credential" },
    kickWebBearer: { encrypted: "website-credential" },
    futureCredential: "must-not-be-copied",
  };
  const before = structuredClone(source);
  assert.deepEqual(createVerificationAccountSeed(source), {
    preferences: source.preferences,
    lastActiveTab: source.lastActiveTab,
    windowBounds: source.windowBounds,
  });
  assert.deepEqual(source, before);
});

test("empty storage remains signed out and invalid storage is rejected", () => {
  assert.deepEqual(createVerificationAccountSeed({}), {});
  for (const value of [null, [], "invalid"]) {
    assert.throws(
      () => createVerificationAccountSeed(value),
      /must be an object/,
    );
  }
});
