import assert from "node:assert/strict";
import test from "node:test";

import { createOAuth2Session } from "@streamfusion/core/auth";

function createCredentialStore(initialCredential = null) {
  let credential = initialCredential;
  return {
    load: async () => credential,
    save: async (nextCredential) => {
      credential = nextCredential;
    },
    clear: async () => {
      credential = null;
    },
  };
}

test("OAuth2Session exposes connected and disconnected state without leaking storage", async () => {
  const store = createCredentialStore();
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => ({
        kind: "transient-failure",
        cause: new Error("offline"),
      }),
    },
  });

  assert.deepEqual(await session.read(), { kind: "disconnected" });
  await store.save({ accessToken: "access", refreshToken: "refresh" });
  assert.deepEqual(await session.read(), {
    kind: "connected",
    credential: { accessToken: "access", refreshToken: "refresh" },
  });
});

test("OAuth2Session shares one refresh and persists the complete rotated credential", async () => {
  const store = createCredentialStore({
    accessToken: "old",
    refreshToken: "refresh-1",
  });
  let resolveRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => {
    markRefreshStarted = resolve;
  });
  let refreshCalls = 0;
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => {
        refreshCalls += 1;
        markRefreshStarted();
        return await new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      },
    },
  });

  const first = session.refresh();
  const second = session.refresh();
  await refreshStarted;
  resolveRefresh({
    kind: "refreshed",
    credential: { accessToken: "new", refreshToken: "refresh-2" },
  });

  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
  assert.equal(refreshCalls, 1);
  assert.equal(firstOutcome, secondOutcome);
  assert.deepEqual(await session.read(), {
    kind: "connected",
    credential: { accessToken: "new", refreshToken: "refresh-2" },
  });
});

test("OAuth2Session preserves credentials after transient refresh failure", async () => {
  const original = { accessToken: "old", refreshToken: "refresh" };
  const store = createCredentialStore(original);
  let authLostCalls = 0;
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => ({
        kind: "transient-failure",
        cause: new Error("offline"),
      }),
    },
  });
  session.onAuthLost(() => {
    authLostCalls += 1;
  });

  const outcome = await session.refresh();

  assert.equal(outcome.kind, "transient-failure");
  assert.equal(authLostCalls, 0);
  assert.deepEqual(await session.read(), {
    kind: "connected",
    credential: original,
  });
});

test("OAuth2Session reports credential persistence failure as transient", async () => {
  const original = { accessToken: "old", refreshToken: "refresh" };
  const store = {
    load: async () => original,
    save: async () => {
      throw new Error("secure storage unavailable");
    },
    clear: async () => {
      throw new Error("must not clear");
    },
  };
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => ({
        kind: "refreshed",
        credential: { accessToken: "new", refreshToken: "rotated" },
      }),
    },
  });

  const outcome = await session.refresh();

  assert.equal(outcome.kind, "transient-failure");
  assert.equal(outcome.cause.message, "secure storage unavailable");
  assert.deepEqual(await session.read(), {
    kind: "connected",
    credential: original,
  });
});

test("OAuth2Session clears only its credential and emits auth lost on permanent rejection", async () => {
  const store = createCredentialStore({
    accessToken: "old",
    refreshToken: "refresh",
  });
  const reasons = [];
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => ({ kind: "auth-lost", reason: "refresh-rejected" }),
    },
  });
  session.onAuthLost((event) => reasons.push(event.reason));

  assert.deepEqual(await session.refresh(), {
    kind: "auth-lost",
    reason: "refresh-rejected",
  });
  assert.deepEqual(await session.read(), { kind: "disconnected" });
  assert.deepEqual(reasons, ["refresh-rejected"]);
});

test("OAuth2Session makes missing-credential policies explicit", async () => {
  const missingStore = createCredentialStore();
  const clearMissingSession = createOAuth2Session({
    credentials: missingStore,
    missingCredential: "auth-lost",
    refresher: {
      refresh: async () => {
        throw new Error("must not run");
      },
    },
  });
  assert.deepEqual(await clearMissingSession.refresh(), {
    kind: "auth-lost",
    reason: "missing-credential",
  });

  const preserveStore = createCredentialStore({ accessToken: "access" });
  const preserveSession = createOAuth2Session({
    credentials: preserveStore,
    missingRefreshToken: "unavailable",
    refresher: {
      refresh: async () => {
        throw new Error("must not run");
      },
    },
  });
  assert.deepEqual(await preserveSession.refresh(), {
    kind: "unavailable",
    reason: "missing-refresh-token",
  });
  assert.equal((await preserveSession.read()).kind, "connected");

  const clearStore = createCredentialStore({ accessToken: "access" });
  const clearSession = createOAuth2Session({
    credentials: clearStore,
    missingRefreshToken: "auth-lost",
    refresher: {
      refresh: async () => {
        throw new Error("must not run");
      },
    },
  });
  assert.deepEqual(await clearSession.refresh(), {
    kind: "auth-lost",
    reason: "missing-refresh-token",
  });
  assert.deepEqual(await clearSession.read(), { kind: "disconnected" });
});

test("OAuth2Session contains unexpected adapter and listener failures", async () => {
  const store = createCredentialStore({
    accessToken: "old",
    refreshToken: "refresh",
  });
  const session = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => {
        throw new Error("adapter bug");
      },
    },
  });
  const unexpected = await session.refresh();
  assert.equal(unexpected.kind, "transient-failure");
  assert.equal(unexpected.cause.message, "adapter bug");

  const notified = [];
  const permanentSession = createOAuth2Session({
    credentials: store,
    refresher: {
      refresh: async () => ({ kind: "auth-lost", reason: "refresh-rejected" }),
    },
  });
  permanentSession.onAuthLost(() => {
    throw new Error("listener bug");
  });
  permanentSession.onAuthLost((event) => notified.push(event.reason));

  await permanentSession.refresh();
  assert.deepEqual(notified, ["refresh-rejected"]);
});

test("OAuth2Session preserves the refresher receiver", async () => {
  const store = createCredentialStore({
    accessToken: "old",
    refreshToken: "refresh",
  });
  const refresher = {
    calls: 0,
    async refresh() {
      this.calls += 1;
      return {
        kind: "refreshed",
        credential: { accessToken: "new", refreshToken: "refresh" },
      };
    },
  };
  const session = createOAuth2Session({ credentials: store, refresher });

  assert.equal((await session.refresh()).kind, "refreshed");
  assert.equal(refresher.calls, 1);
});
