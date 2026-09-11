import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  KICK_ANDROID_REDIRECT_URI,
  KICK_APP_SCOPES,
} from "../capabilities/kick-account-auth.ts";
import {
  isKickAndroidRedirectUri,
  judgeKickCallback,
  kickAttemptId,
  kickCredentialGeneration,
} from "../domain/kick-account-auth.ts";

const redirect = KICK_ANDROID_REDIRECT_URI;
const attemptId = kickAttemptId("attempt-1");
const attempt = {
  attemptId,
  codeVerifier: "a".repeat(43),
  expiresAtEpochMs: 10_000,
  generation: kickCredentialGeneration(0),
  redirectUri: redirect,
  state: "live-state",
};

function callback(change = {}) {
  return {
    code: "kick-code",
    error: null,
    receivedAtEpochMs: 5_000,
    redirectUri: redirect,
    state: "live-state",
    ...change,
  };
}

test("Android redirect constant is the exact hosted Worker callback", () => {
  assert.equal(
    redirect,
    "https://streamfusion.leveluptogetherbiz.workers.dev/auth/kick/android/callback",
  );
  assert.equal(isKickAndroidRedirectUri(redirect), true);
  assert.equal(isKickAndroidRedirectUri(`${redirect}/`), false);
  assert.equal(isKickAndroidRedirectUri(`${redirect}?x=1`), false);
  assert.deepEqual(KICK_APP_SCOPES, [
    "user:read",
    "channel:read",
    "chat:write",
    "moderation:chat_message:manage",
    "moderation:ban",
    "events:subscribe",
  ]);
  const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../..",
  );
  const workerGrant = readFileSync(
    path.join(
      workspaceRoot,
      "apps/worker/src/features/kick-oauth/domain/kick-grant.ts",
    ),
    "utf8",
  );
  const mobileAppConfig = readFileSync(
    path.join(workspaceRoot, "apps/mobile/app.json"),
    "utf8",
  );
  assert.match(workerGrant, new RegExp(`"${redirect.replaceAll("/", "\\/")}"`));
  assert.match(
    mobileAppConfig,
    /"host": "streamfusion.leveluptogetherbiz.workers.dev"/,
  );
  assert.match(
    mobileAppConfig,
    /"pathPrefix": "\/auth\/kick\/android\/callback"/,
  );
});

test("callback verdicts cover accept, deny, expiry, and ownership failures", () => {
  assert.deepEqual(
    judgeKickCallback({ attempt, callback: callback(), consumed: null }),
    { kind: "accepted", attemptId, code: "kick-code" },
  );
  assert.deepEqual(
    judgeKickCallback({
      attempt,
      callback: callback({ error: "access_denied", code: null }),
      consumed: null,
    }),
    { kind: "denied", attemptId, reason: "access_denied" },
  );
  assert.deepEqual(
    judgeKickCallback({
      attempt,
      callback: callback({ code: null }),
      consumed: null,
    }),
    { kind: "denied", attemptId, reason: "missing-code" },
  );
  assert.deepEqual(
    judgeKickCallback({
      attempt,
      callback: callback({ receivedAtEpochMs: 10_000 }),
      consumed: null,
    }),
    { kind: "expired", attemptId },
  );
  assert.equal(
    judgeKickCallback({
      attempt: null,
      callback: callback(),
      consumed: null,
    }).kind,
    "stale",
  );
  assert.equal(
    judgeKickCallback({
      attempt,
      callback: callback(),
      consumed: { attemptId, state: "live-state" },
    }).kind,
    "duplicate",
  );
  assert.deepEqual(
    judgeKickCallback({
      attempt,
      callback: callback({ state: "other-state" }),
      consumed: null,
    }),
    { kind: "state-mismatch", attemptId },
  );
  assert.deepEqual(
    judgeKickCallback({
      attempt,
      callback: callback({
        redirectUri: "https://attacker.example/auth/kick/android/callback",
      }),
      consumed: null,
    }),
    { kind: "wrong-redirect", attemptId },
  );
  assert.equal(
    judgeKickCallback({
      attempt,
      callback: callback({ state: "old-state" }),
      consumed: null,
      replacedAttempts: [
        { attemptId: kickAttemptId("attempt-0"), state: "old-state" },
      ],
    }).kind,
    "superseded",
  );
});
