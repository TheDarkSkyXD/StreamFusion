import assert from "node:assert/strict";
import test from "node:test";

import {
  canPollDeviceCode,
  missingScopes,
  nextDevicePollAt,
  shouldValidateTwitchSession,
} from "../domain/twitch-account-auth.ts";

test("device polling obeys provider cadence, expiry, and attempt ownership", () => {
  const state = {
    kind: "pending",
    attemptId: "attempt-1",
    expiresAtEpochMs: 20_000,
    nextPollAtEpochMs: nextDevicePollAt({
      intervalSeconds: 5,
      nowEpochMs: 1_000,
    }),
    userCode: "ABCDEFGH",
    verificationUri: "https://www.twitch.tv/activate",
  };
  assert.equal(
    canPollDeviceCode({ attemptId: "attempt-1", nowEpochMs: 5_999, state }),
    false,
  );
  assert.equal(
    canPollDeviceCode({ attemptId: "attempt-1", nowEpochMs: 6_000, state }),
    true,
  );
  assert.equal(
    canPollDeviceCode({ attemptId: "attempt-2", nowEpochMs: 6_000, state }),
    false,
  );
  assert.equal(
    canPollDeviceCode({ attemptId: "attempt-1", nowEpochMs: 20_000, state }),
    false,
  );
});

test("validation is due hourly and scope gaps retain required order", () => {
  assert.equal(
    shouldValidateTwitchSession({
      lastValidatedAtEpochMs: 0,
      nowEpochMs: 3_599_999,
    }),
    false,
  );
  assert.equal(
    shouldValidateTwitchSession({
      lastValidatedAtEpochMs: 0,
      nowEpochMs: 3_600_000,
    }),
    true,
  );
  assert.deepEqual(missingScopes(["chat:read"], ["chat:read", "chat:edit"]), [
    "chat:edit",
  ]);
});
