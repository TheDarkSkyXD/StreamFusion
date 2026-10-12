import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createRelayWorker } from "../src/composition/worker";

const instances: Miniflare[] = [];
const at = Date.parse("2026-09-15T12:00:00.000Z");
const controller = { scheduledTime: at, cron: "* * * * *", noRetry() {} };
const token = (suffix: string) =>
  `dK3kFcmTokenForIntegrationProof:APA91b0123456789${suffix}`;

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function fixture() {
  const instance = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch: () => new Response('ok') }",
      d1Databases: { INSTALLATION_REGISTRY: "notification-test" }
    })
  );
  instances.push(instance);
  const database = await instance.getD1Database("INSTALLATION_REGISTRY");
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  const providerSecret = "test-provider-secret";
  const env = {
    INSTALLATION_REGISTRY: database,
    RELAY_CREDENTIAL_HMAC_SECRET:
      "integration-test-secret-with-at-least-32-characters",
    RELAY_ENVIRONMENT: "development",
    TWITCH_CLIENT_ID: "test-twitch-id",
    TWITCH_CLIENT_SECRET: providerSecret,
    KICK_CLIENT_ID: "test-kick-id",
    KICK_CLIENT_SECRET: providerSecret,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "test-project",
      client_email: "test@example.invalid",
      private_key: key
    })
  };
  let nowMs = at;
  let twitchStreams: unknown[] = [];
  let twitchOverride: Response | null = null;
  let kickStreams: unknown[] = [];
  let kickChannelsOverride: Response | null = null;
  let fcmStatus = 200;
  let fcmHook: (() => Promise<void>) | null = null;
  let twitchHook: (() => void) | null = null;
  const sent: unknown[] = [];
  const requests: URL[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    requests.push(url);
    if (url.hostname === "id.twitch.tv" || url.hostname === "id.kick.com")
      return Response.json({ access_token: "provider-test", expires_in: 3600 });
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "google-test", expires_in: 3600 });
    if (url.hostname === "api.twitch.tv" && url.pathname === "/helix/streams") {
      twitchHook?.();
      return twitchOverride?.clone() ?? Response.json({ data: twitchStreams });
    }
    if (
      url.hostname === "api.kick.com" &&
      url.pathname === "/public/v1/channels"
    )
      return (
        kickChannelsOverride?.clone() ??
        Response.json({
          data: url.searchParams.getAll("slug").map((slug) => ({
            broadcaster_user_id:
              slug === "kickproof" ? 501 : 1000 + Number(slug.slice(4)),
            slug,
            stream: { is_live: kickStreams.length > 0 }
          }))
        })
      );
    if (
      url.hostname === "api.kick.com" &&
      url.pathname === "/public/v1/livestreams"
    )
      return Response.json({ data: kickStreams });
    if (url.hostname === "fcm.googleapis.com") {
      sent.push(JSON.parse(String(init?.body)) as unknown);
      await fcmHook?.();
      return fcmStatus === 200
        ? Response.json({ name: "projects/test-project/messages/test" })
        : Response.json(
            {
              error: {
                status:
                  fcmStatus === 404 ? "UNREGISTERED" : "RESOURCE_EXHAUSTED"
              }
            },
            { status: fcmStatus, headers: { "Retry-After": "120" } }
          );
    }
    throw new Error(`Unexpected upstream request ${url.href}`);
  };
  const worker = () => createRelayWorker({ now: () => nowMs, fetch: upstream });
  return {
    database,
    env,
    worker,
    sent,
    requests,
    setTwitch(streams: unknown[]) {
      twitchStreams = streams;
      twitchOverride = null;
    },
    setTwitchResponse(response: Response) {
      twitchOverride = response;
    },
    setKick(streams: unknown[]) {
      kickStreams = streams;
    },
    setKickChannelsResponse(response: Response | null) {
      kickChannelsOverride = response;
    },
    setFcmStatus(status: number) {
      fcmStatus = status;
    },
    setFcmHook(hook: (() => Promise<void>) | null) {
      fcmHook = hook;
    },
    setTwitchHook(hook: (() => void) | null) {
      twitchHook = hook;
    },
    advance(ms = 61_000) {
      nowMs += ms;
    }
  };
}

async function register(
  f: Awaited<ReturnType<typeof fixture>>,
  installationId: string,
  pairs: readonly unknown[],
  enabled = true
) {
  const worker = f.worker();
  const registration = await worker.fetch(
    new Request("https://relay.test/v1/installations/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        environment: "development",
        installationId,
        registrationId: `register-${installationId}-95B4xv59NSmcKQz33cAj9g`
      })
    }),
    f.env
  );
  expect(registration.status).toBe(200);
  const grant = (await registration.json()) as {
    outcome: { body: { credential: string } };
  };
  const response = await worker.fetch(
    new Request("https://relay.test/v1/notifications/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${grant.outcome.body.credential}`
      },
      body: JSON.stringify({
        schemaVersion: 1,
        nativeToken: token(installationId),
        tokenType: "fcm",
        projection: {
          schemaVersion: 1,
          version: 1,
          pairs,
          delivery: { silent: false, restartGracePeriodMinutes: 0 }
        },
        remoteDeliveryEnabled: enabled
      })
    }),
    f.env
  );
  expect(response.status).toBe(200);
  return grant.outcome.body.credential;
}

async function updatePush(
  f: Awaited<ReturnType<typeof fixture>>,
  credential: string,
  installationId: string,
  pairs: readonly unknown[],
  nativeToken = token(installationId),
  delivery = { silent: true, restartGracePeriodMinutes: 0 }
) {
  const response = await f.worker().fetch(
    new Request("https://relay.test/v1/notifications/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`
      },
      body: JSON.stringify({
        schemaVersion: 1,
        nativeToken,
        tokenType: "fcm",
        projection: {
          schemaVersion: 1,
          version: 2,
          pairs,
          delivery
        },
        remoteDeliveryEnabled: true
      })
    }),
    f.env
  );
  expect(response.status).toBe(200);
}

describe("scheduled live delivery through a local D1 database", () => {
  it("sends only enabled Twitch and Kick followers after an offline baseline, once across isolates", async () => {
    const f = await fixture();
    await register(f, "install-twitch", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await register(f, "install-kick", [
      { platform: "kick", channelId: "public-51", channelLogin: "kickproof" }
    ]);
    await register(
      f,
      "install-disabled",
      [{ platform: "twitch", channelId: "101", channelLogin: "twitchproof" }],
      false
    );
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(0);
    f.advance();
    f.setTwitch([
      {
        id: "session-1",
        user_id: "101",
        user_login: "twitchproof",
        user_name: "TwitchProof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "2026-09-15T12:01:00Z",
        stream_title: "Live"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
    const messages = f.sent.map(
      (request) =>
        (request as { message: { token: string; data: { payload: string } } })
          .message
    );
    expect(messages.map((message) => message.token).sort()).toEqual(
      [token("install-kick"), token("install-twitch")].sort()
    );
    expect(messages.every((message) => !("topic" in message))).toBe(true);
    expect(
      messages
        .map((message) => JSON.parse(message.data.payload).destination)
        .sort((a, b) => a.platform.localeCompare(b.platform))
    ).toEqual([
      {
        kind: "watch-channel",
        platform: "kick",
        channelId: "public-51",
        channelLogin: "kickproof",
        streamState: "live"
      },
      {
        kind: "watch-channel",
        platform: "twitch",
        channelId: "101",
        channelLogin: "twitchproof",
        streamState: "live"
      }
    ]);
    expect(
      f.requests
        .find((url) => url.pathname === "/helix/streams")
        ?.searchParams.get("first")
    ).toBe("100");
    const kickQuery = f.requests.find(
      (url) => url.pathname === "/public/v1/livestreams"
    )?.searchParams;
    expect(kickQuery?.getAll("broadcaster_user_id")).toEqual(["501"]);
    expect(kickQuery?.get("limit")).toBe("50");
    f.advance();
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
  });

  it("persists a retry deadline and rechecks the current token and membership", async () => {
    const f = await fixture();
    const pair = {
      platform: "twitch",
      channelId: "101",
      channelLogin: "twitchproof"
    };
    const credential = await register(f, "install-retry", [pair]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-retry",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    f.setFcmStatus(429);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    f.setFcmStatus(200);
    await updatePush(
      f,
      credential,
      "install-retry",
      [pair],
      token("install-retry-rotated")
    );
    f.advance(61_000);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    f.advance(61_000);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
    expect((f.sent[1] as { message: { token: string } }).message.token).toBe(
      token("install-retry-rotated")
    );
    expect(
      (f.sent[1] as { message: { data: { silent: string } } }).message.data
        .silent
    ).toBe("true");
    await f.database
      .prepare(
        "UPDATE native_push_tokens SET projection_json = ? WHERE installation_id = ?"
      )
      .bind(
        JSON.stringify({ schemaVersion: 1, version: 3, pairs: [] }),
        "install-retry"
      )
      .run();
    f.advance();
    f.setTwitch([]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
  });

  it("starts Retry-After at the provider response after a slow send", async () => {
    const f = await fixture();
    await register(f, "install-slow-retry", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-slow-retry",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    f.setFcmStatus(429);
    f.setFcmHook(async () => {
      f.advance(20_000);
      f.setFcmHook(null);
    });
    await f.worker().scheduled(controller, f.env);
    const retry = await f.database
      .prepare(
        "SELECT next_attempt_ms FROM live_outbox WHERE installation_id = 'install-slow-retry'"
      )
      .first<{ next_attempt_ms: number }>();
    expect(retry?.next_attempt_ms).toBe(at + 61_000 + 20_000 + 120_000);
  });

  it("serializes pending sessions for one installation and pair before applying restart grace", async () => {
    const f = await fixture();
    const pair = {
      platform: "twitch",
      channelId: "101",
      channelLogin: "twitchproof"
    };
    const credential = await register(f, "install-grace-race", [pair]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-grace-race",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    await updatePush(
      f,
      credential,
      "install-grace-race",
      [pair],
      token("install-grace-race"),
      { silent: false, restartGracePeriodMinutes: 5 }
    );
    await f.database
      .prepare(
        "DELETE FROM live_last_alert WHERE installation_id = 'install-grace-race'"
      )
      .run();
    f.advance();
    const clone = `INSERT INTO live_outbox
      (event_id, installation_id, pair_key, payload_json, status,
       attempts, next_attempt_ms, expires_ms)
      SELECT ?, installation_id, pair_key, payload_json, 'pending',
             0, ?, ? FROM live_outbox WHERE installation_id = 'install-grace-race'
      LIMIT 1`;
    await f.database.batch([
      f.database.prepare(clone).bind("grace-a", at + 122_000, at + 15 * 60_000),
      f.database.prepare(clone).bind("grace-b", at + 122_000, at + 15 * 60_000)
    ]);
    f.setFcmHook(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
    const outcomes = await f.database
      .prepare(
        "SELECT status FROM live_outbox WHERE event_id LIKE 'grace-%' ORDER BY event_id"
      )
      .all<{ status: string }>();
    expect(outcomes.results).toEqual([
      { status: "accepted" },
      { status: "skipped" }
    ]);
  });

  it("keeps the last live observation across failed and malformed provider reads", async () => {
    const f = await fixture();
    await register(f, "install-malformed", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-stable",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    f.advance();
    f.setTwitchResponse(new Response("failed", { status: 500 }));
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitchResponse(new Response("{", { status: 200 }));
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitchResponse(Response.json({ data: [{ id: "broken" }] }));
    await f.worker().scheduled(controller, f.env);
    const state = await f.database
      .prepare(
        "SELECT state, session_key FROM live_observations WHERE pair_key = 'twitch:101'"
      )
      .first<{ state: string; session_key: string }>();
    expect(state).toMatchObject({
      state: "live",
      session_key: "session-stable"
    });
    f.advance();
    f.setTwitch([
      {
        id: "session-stable",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
  });

  it("allows only one claim under concurrent scheduled invocations", async () => {
    const f = await fixture();
    await register(f, "install-concurrent", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-concurrent",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await Promise.all([
      f.worker().scheduled(controller, f.env),
      f.worker().scheduled(controller, f.env)
    ]);
    expect(f.sent).toHaveLength(1);
    const events = await f.database
      .prepare("SELECT event_id FROM live_events")
      .all<{ event_id: string }>();
    const outbox = await f.database
      .prepare("SELECT event_id, status FROM live_outbox")
      .all<{ event_id: string; status: string }>();
    expect(events.results).toHaveLength(1);
    expect(outbox.results).toEqual([
      { event_id: events.results[0]?.event_id, status: "accepted" }
    ]);
  });

  it("keeps a pending send leased after slow provider polling", async () => {
    const f = await fixture();
    await register(f, "install-slow-provider", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-slow-provider",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    f.setTwitchHook(() => {
      f.advance(46_000);
      f.setTwitchHook(null);
    });
    f.setFcmHook(async () => {
      f.setFcmHook(null);
      f.advance(20_000);
      await f.worker().scheduled(controller, f.env);
    });
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
  });

  it("drains a live event for 320 installations before the delivery window expires", async () => {
    const f = await fixture();
    const pair = {
      platform: "twitch",
      channelId: "101",
      channelLogin: "twitchproof"
    };
    await register(f, "install-fanout-0", [pair]);
    await f.worker().scheduled(controller, f.env);
    await f.database.batch(
      Array.from({ length: 319 }, (_, index) =>
        f.database
          .prepare(
            `INSERT INTO native_push_tokens
             SELECT ?, ?, token_hash, token_type, projection_json,
                    remote_delivery_enabled, registered_at, rotated_at
             FROM native_push_tokens WHERE installation_id = 'install-fanout-0'`
          )
          .bind(
            `install-fanout-${index + 1}`,
            token(`install-fanout-${index + 1}`)
          )
      )
    );
    let activeSends = 0;
    let peakSends = 0;
    f.setFcmHook(async () => {
      activeSends += 1;
      peakSends = Math.max(peakSends, activeSends);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeSends -= 1;
    });
    f.advance();
    f.setTwitch([
      {
        id: "session-fanout",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    for (let tick = 0; tick < 4; tick += 1) {
      await f.worker().scheduled(controller, f.env);
      f.advance();
    }
    const statuses = await f.database
      .prepare(
        "SELECT status, count(*) AS total FROM live_outbox GROUP BY status"
      )
      .all<{ status: string; total: number }>();
    expect(statuses.results).toEqual([{ status: "accepted", total: 320 }]);
    expect(f.sent).toHaveLength(320);
    expect(peakSends).toBe(4);
  }, 60_000);

  it("records a live event with more than 1000 recipients and advances its next observation", async () => {
    const f = await fixture();
    await register(f, "install-large-0", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    await f.database
      .prepare(
        `WITH RECURSIVE recipients(n) AS (
           SELECT 1 UNION ALL SELECT n + 1 FROM recipients WHERE n < 1000
         )
         INSERT INTO native_push_tokens
         SELECT 'install-large-' || recipients.n,
                native_push_tokens.native_token || recipients.n,
                native_push_tokens.token_hash,
                native_push_tokens.token_type,
                native_push_tokens.projection_json,
                native_push_tokens.remote_delivery_enabled,
                native_push_tokens.registered_at,
                native_push_tokens.rotated_at
         FROM native_push_tokens CROSS JOIN recipients
         WHERE native_push_tokens.installation_id = 'install-large-0'`
      )
      .run();
    f.advance();
    f.setTwitch([
      {
        id: "session-large",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    const outbox = await f.database
      .prepare("SELECT count(*) AS total FROM live_outbox")
      .first<{ total: number }>();
    expect(outbox?.total).toBe(1001);
    expect(f.sent.length).toBeGreaterThan(0);
    f.advance();
    await f.worker().scheduled(controller, f.env);
    const observation = await f.database
      .prepare(
        "SELECT observed_ms FROM live_observations WHERE pair_key = 'twitch:101'"
      )
      .first<{ observed_ms: number }>();
    expect(observation?.observed_ms).toBe(at + 122_000);
  }, 60_000);

  it("observes a resolved Kick slug while retaining an unresolved slug's live state", async () => {
    const f = await fixture();
    await register(f, "install-kick-partial", [
      { platform: "kick", channelId: "public-0", channelLogin: "kick0" },
      { platform: "kick", channelId: "public-1", channelLogin: "kick1" }
    ]);
    f.setKick([
      {
        broadcaster_user_id: 1001,
        channel_id: 2001,
        slug: "kick1",
        started_at: "2026-09-15T12:00:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setKickChannelsResponse(
      Response.json({
        data: [{ broadcaster_user_id: 1000, slug: "kick0" }]
      })
    );
    f.setKick([
      {
        broadcaster_user_id: 1000,
        channel_id: 2000,
        slug: "kick0",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    const states = await f.database
      .prepare(
        "SELECT pair_key, state FROM live_observations ORDER BY pair_key"
      )
      .all<{ pair_key: string; state: string }>();
    expect(states.results).toEqual([
      { pair_key: "kick:public-0", state: "live" },
      { pair_key: "kick:public-1", state: "live" }
    ]);
  });

  it("sends fresh pending work past expired rows without treating expired rows as backlog", async () => {
    const f = await fixture();
    await register(f, "install-expired", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-expired",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    f.advance();
    const clone = `INSERT INTO live_outbox
      (event_id, installation_id, pair_key, payload_json, status,
       attempts, next_attempt_ms, expires_ms)
      SELECT ?, installation_id, pair_key, payload_json, 'pending',
             0, ?, ? FROM live_outbox WHERE installation_id = 'install-expired'
      LIMIT 1`;
    await f.database.batch([
      ...Array.from({ length: 120 }, (_, index) =>
        f.database.prepare(clone).bind(`expired-${index}`, at, at + 1)
      ),
      f.database.prepare(clone).bind("fresh", at + 122_000, at + 15 * 60_000)
    ]);
    await f.worker().scheduled(controller, f.env);
    const fresh = await f.database
      .prepare("SELECT status FROM live_outbox WHERE event_id = 'fresh'")
      .first<{ status: string }>();
    expect(fresh?.status).toBe("accepted");
    expect(f.sent).toHaveLength(2);
  });

  it("replays the same event ID after an accepted send loses its acknowledgement", async () => {
    const f = await fixture();
    await register(f, "install-crash", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-crash",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    await f.database
      .prepare(
        "UPDATE live_outbox SET status = 'pending', lease_token = NULL, lease_until_ms = NULL WHERE installation_id = 'install-crash'"
      )
      .run();
    await f.database
      .prepare(
        "DELETE FROM live_last_alert WHERE installation_id = 'install-crash'"
      )
      .run();
    f.advance();
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
    const eventIds = f.sent.map(
      (request) =>
        JSON.parse(
          (request as { message: { data: { payload: string } } }).message.data
            .payload
        ).eventId
    );
    expect(eventIds[0]).toBe(eventIds[1]);
  });

  it("rejects registration when remote delivery configuration is unavailable", async () => {
    const f = await fixture();
    const { FCM_SERVICE_ACCOUNT_JSON: configuredAccount, ...unconfiguredEnv } =
      f.env;
    expect(configuredAccount).toBeDefined();
    const credential = await register(f, "install-config", [
      { platform: "twitch", channelId: "101", channelLogin: "twitchproof" }
    ]);
    const response = await f.worker().fetch(
      new Request("https://relay.test/v1/notifications/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential}`
        },
        body: JSON.stringify({
          schemaVersion: 1,
          nativeToken: token("new-config"),
          tokenType: "fcm",
          projection: {
            schemaVersion: 1,
            version: 1,
            pairs: [
              {
                platform: "twitch",
                channelId: "101",
                channelLogin: "twitchproof"
              }
            ]
          },
          remoteDeliveryEnabled: true
        })
      }),
      unconfiguredEnv
    );
    expect(response.status).toBe(503);
    const record = await f.database
      .prepare(
        "SELECT native_token FROM native_push_tokens WHERE installation_id = 'install-config'"
      )
      .first<{ native_token: string }>();
    expect(record?.native_token).toBe(token("install-config"));
  });

  it("skips pending work after an unfollow and preserves a rotated token when the attempted token is unregistered", async () => {
    const pair = {
      platform: "twitch",
      channelId: "101",
      channelLogin: "twitchproof"
    };
    const f = await fixture();
    const credential = await register(f, "install-unfollow", [pair]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-unfollow",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    f.setFcmStatus(429);
    await f.worker().scheduled(controller, f.env);
    await updatePush(f, credential, "install-unfollow", []);
    f.advance(121_000);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    const row = await f.database
      .prepare(
        "SELECT status FROM live_outbox WHERE installation_id = 'install-unfollow'"
      )
      .first<{ status: string }>();
    expect(row?.status).toBe("skipped");
    const observation = await f.database
      .prepare(
        "SELECT pair_key FROM live_observations WHERE pair_key = 'twitch:101'"
      )
      .first<{ pair_key: string }>();
    expect(observation).toBeNull();

    const second = await fixture();
    const secondCredential = await register(second, "install-rotation", [pair]);
    await second.worker().scheduled(controller, second.env);
    second.advance();
    second.setTwitch([
      {
        id: "session-rotation",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    second.setFcmStatus(404);
    second.setFcmHook(async () => {
      second.setFcmHook(null);
      await updatePush(
        second,
        secondCredential,
        "install-rotation",
        [pair],
        token("install-rotation-new")
      );
    });
    await second.worker().scheduled(controller, second.env);
    const tokenRow = await second.database
      .prepare(
        "SELECT native_token, remote_delivery_enabled FROM native_push_tokens WHERE installation_id = 'install-rotation'"
      )
      .first<{ native_token: string; remote_delivery_enabled: number }>();
    expect(tokenRow).toMatchObject({
      native_token: token("install-rotation-new"),
      remote_delivery_enabled: 1
    });
  });

  it("covers 101 Twitch and 51 Kick follows with bounded official query batches", async () => {
    const f = await fixture();
    const twitchPairs = Array.from({ length: 101 }, (_, index) => ({
      platform: "twitch",
      channelId: `${10000 + index}`,
      channelLogin: `twitch${index}`
    }));
    const kickPairs = Array.from({ length: 51 }, (_, index) => ({
      platform: "kick",
      channelId: `public-${index}`,
      channelLogin: `kick${index}`
    }));
    await register(f, "install-batches", [...twitchPairs, ...kickPairs]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch(
      twitchPairs.map((pair, index) => ({
        id: `session-${index}`,
        user_id: pair.channelId,
        user_login: pair.channelLogin,
        type: "live",
        started_at: "2026-09-15T12:01:00Z"
      }))
    );
    f.setKick(
      kickPairs.map((pair, index) => ({
        broadcaster_user_id: 1000 + index,
        channel_id: 2000 + index,
        slug: pair.channelLogin,
        started_at: "2026-09-15T12:01:00Z"
      }))
    );
    await f.worker().scheduled(controller, f.env);
    const twitchRequests = f.requests.filter(
      (url) => url.pathname === "/helix/streams"
    );
    const kickRequests = f.requests.filter(
      (url) => url.pathname === "/public/v1/livestreams"
    );
    expect(
      twitchRequests.map((url) => url.searchParams.getAll("user_id").length)
    ).toEqual([100, 1, 100, 1]);
    expect(
      twitchRequests.every((url) => url.searchParams.get("first") === "100")
    ).toBe(true);
    expect(
      kickRequests.map(
        (url) => url.searchParams.getAll("broadcaster_user_id").length
      )
    ).toEqual([50, 1, 50, 1]);
    const observed = await f.database
      .prepare("SELECT count(*) AS total FROM live_observations")
      .first<{ total: number }>();
    expect(observed?.total).toBe(152);
  }, 15_000);

  it("treats a new Kick start time as a distinct session while retaining the original follow identity", async () => {
    const f = await fixture();
    await register(f, "install-kick-sessions", [
      { platform: "kick", channelId: "public-51", channelLogin: "kickproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "2026-09-15T12:02:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(2);
    const payloads = f.sent.map((request) =>
      JSON.parse(
        (request as { message: { data: { payload: string } } }).message.data
          .payload
      )
    );
    expect(payloads[0].eventId).not.toBe(payloads[1].eventId);
    expect(payloads.map((payload) => payload.destination.channelId)).toEqual([
      "public-51",
      "public-51"
    ]);
  });

  it("seeds an already-live stream silently and applies restart grace to later sessions", async () => {
    const f = await fixture();
    const pair = {
      platform: "twitch",
      channelId: "101",
      channelLogin: "twitchproof"
    };
    const credential = await register(f, "install-grace", [pair]);
    f.setTwitch([
      {
        id: "session-existing",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T11:50:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(0);
    f.advance();
    f.setTwitch([]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setTwitch([
      {
        id: "session-new",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:02:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    await updatePush(
      f,
      credential,
      "install-grace",
      [pair],
      token("install-grace"),
      {
        silent: false,
        restartGracePeriodMinutes: 15
      }
    );
    f.advance();
    f.setTwitch([
      {
        id: "session-again",
        user_id: "101",
        user_login: "twitchproof",
        type: "live",
        started_at: "2026-09-15T12:03:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
  });

  it("preserves live Kick state through incomplete identity resolution and invalid start times", async () => {
    const f = await fixture();
    await register(f, "install-kick-invalid", [
      { platform: "kick", channelId: "public-51", channelLogin: "kickproof" }
    ]);
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
    f.advance();
    f.setKickChannelsResponse(Response.json({ data: [] }));
    await f.worker().scheduled(controller, f.env);
    f.advance();
    f.setKickChannelsResponse(null);
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "0001-01-01T00:00:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    const observation = await f.database
      .prepare(
        "SELECT state, session_key FROM live_observations WHERE pair_key = 'kick:public-51'"
      )
      .first<{ state: string; session_key: string }>();
    expect(observation).toMatchObject({
      state: "live",
      session_key: "501:2026-09-15T12:01:00.000Z"
    });
    f.advance();
    f.setKick([
      {
        broadcaster_user_id: 501,
        channel_id: 999,
        slug: "kickproof",
        started_at: "2026-09-15T12:01:00Z"
      }
    ]);
    await f.worker().scheduled(controller, f.env);
    expect(f.sent).toHaveLength(1);
  });
});
