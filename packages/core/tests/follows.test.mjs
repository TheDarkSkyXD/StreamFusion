import assert from "node:assert/strict";
import test from "node:test";

import {
  planAccountFollowSync,
  resolveFollowMutation,
  selectActiveFollowCollection,
} from "@streamfusion/core/follows";

test("active follow collections keep guest and account modes separate", () => {
  assert.deepEqual(
    selectActiveFollowCollection({ platform: "kick", authenticated: false }),
    { kind: "source", source: "guest" },
  );
  assert.deepEqual(
    selectActiveFollowCollection({ platform: "kick", authenticated: true }),
    { kind: "source", source: "kick" },
  );
  assert.deepEqual(
    selectActiveFollowCollection({
      platform: "kick",
      authenticated: true,
      accountCollectionAvailable: false,
    }),
    { kind: "unavailable" },
  );
});

test("follow mutations target the account only when policy permits it", () => {
  assert.deepEqual(
    resolveFollowMutation({
      platform: "twitch",
      currentSource: null,
      accountAuthenticated: true,
    }),
    { target: "account", action: "follow", platform: "twitch" },
  );
  assert.deepEqual(
    resolveFollowMutation({
      platform: "twitch",
      currentSource: null,
      accountAuthenticated: false,
    }),
    { target: "guest", action: "follow", platform: "twitch" },
  );
  assert.deepEqual(
    resolveFollowMutation({
      platform: "kick",
      currentSource: "guest",
      accountAuthenticated: true,
    }),
    { target: "guest", action: "unfollow", platform: "kick" },
  );
  assert.deepEqual(
    resolveFollowMutation({
      platform: "kick",
      currentSource: "kick",
      accountAuthenticated: false,
    }),
    { target: "account", action: "unfollow", platform: "kick" },
  );
});

test("follow sync applies trustworthy snapshots and preserves rows on failure", () => {
  assert.deepEqual(
    planAccountFollowSync({
      kind: "available",
      follows: [{ id: "one" }],
      authoritative: true,
    }),
    { kind: "apply", follows: [{ id: "one" }], pruneAbsent: true },
  );
  assert.deepEqual(
    planAccountFollowSync({
      kind: "available",
      follows: [{ id: "partial" }],
      authoritative: false,
    }),
    { kind: "apply", follows: [{ id: "partial" }], pruneAbsent: false },
  );
  assert.deepEqual(
    planAccountFollowSync({ kind: "unavailable", reason: "offline" }),
    { kind: "preserve", reason: "offline" },
  );
});
