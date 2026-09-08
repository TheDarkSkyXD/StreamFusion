import assert from "node:assert/strict";
import test from "node:test";

import {
  activityItemSchema,
  markActivityItemRead,
  reconcileActivityItem,
  selectRetainedActivityEventIds,
  toSerializedTimestamp,
} from "@streamfusion/core/activity";

const occurredAt = toSerializedTimestamp("2026-09-04T12:00:00.000Z");

function channelAlert(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "live:twitch:channel-1:2026-09-04T12:00:00.000Z",
    kind: "channel",
    event: "live-alert",
    source: "local",
    occurredAt,
    readAt: null,
    title: "ProofStreamer is live",
    body: "A local Activity item",
    channel: {
      platform: "twitch",
      id: "channel-1",
      login: "proofstreamer",
      displayName: "ProofStreamer",
    },
    destination: {
      kind: "watch-channel",
      platform: "twitch",
      channelId: "channel-1",
      channelLogin: "proofstreamer",
    },
    ...overrides,
  };
}

function jobActivity(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "job:local:recording-1",
    kind: "job",
    source: "local",
    occurredAt,
    readAt: null,
    title: "Recording",
    body: "A local recording job",
    job: { id: "recording-1", state: { kind: "active" } },
    destination: { kind: "media-job", jobId: "recording-1" },
    ...overrides,
  };
}

function systemActivity(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "device:health:v1",
    kind: "system",
    event: "device-health",
    source: "local",
    occurredAt,
    readAt: null,
    title: "Device health",
    body: "A local device update",
    destination: { kind: "diagnostics" },
    ...overrides,
  };
}

test("Activity schema accepts safe destinations and rejects URLs or unknown fields", () => {
  assert.equal(activityItemSchema.is(channelAlert()), true);
  assert.equal(
    activityItemSchema.is({ ...channelAlert(), playableUrl: "https://secret" }),
    false,
  );
  assert.equal(
    activityItemSchema.is({
      ...channelAlert(),
      destination: { kind: "watch-channel", url: "https://example.com" },
    }),
    false,
  );
  assert.equal(
    activityItemSchema.is({
      ...channelAlert(),
      eventId: "event/unsafe",
    }),
    false,
  );
  assert.equal(
    activityItemSchema.is({
      ...channelAlert(),
      channel: { ...channelAlert().channel, login: "x".repeat(65) },
      destination: {
        ...channelAlert().destination,
        channelLogin: "x".repeat(65),
      },
    }),
    false,
  );
});

test("duplicate event reconciliation preserves read state across Activity kinds", () => {
  const readAt = toSerializedTimestamp("2026-09-04T12:01:00.000Z");
  const incomingReadAt = toSerializedTimestamp("2026-09-04T12:02:00.000Z");
  for (const createItem of [channelAlert, jobActivity, systemActivity]) {
    const existing = markActivityItemRead(createItem(), readAt);
    const reconciledWithIncomingUnread = reconcileActivityItem(
      existing,
      createItem({
        occurredAt: incomingReadAt,
        readAt: null,
        title: "Updated Activity item",
      }),
    );
    const reconciledWithIncomingRead = reconcileActivityItem(
      existing,
      createItem({ occurredAt: incomingReadAt, readAt: incomingReadAt }),
    );
    const unreadReconciledWithIncomingRead = reconcileActivityItem(
      createItem(),
      createItem({ occurredAt: incomingReadAt, readAt: incomingReadAt }),
    );

    assert.equal(reconciledWithIncomingUnread.title, "Updated Activity item");
    assert.equal(reconciledWithIncomingUnread.occurredAt, existing.occurredAt);
    assert.equal(reconciledWithIncomingUnread.readAt, readAt);
    assert.equal(reconciledWithIncomingRead.readAt, readAt);
    assert.equal(unreadReconciledWithIncomingRead.readAt, null);
    assert.equal(
      markActivityItemRead(reconciledWithIncomingUnread, readAt),
      reconciledWithIncomingUnread,
    );
  }
  assert.throws(
    () =>
      reconcileActivityItem(
        channelAlert(),
        channelAlert({ eventId: "different" }),
      ),
    /event identity/u,
  );
});

test("retention keeps active jobs and bounds completed Activity", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const old = {
    schemaVersion: 1,
    eventId: "old",
    kind: "system",
    event: "device-health",
    source: "local",
    occurredAt: toSerializedTimestamp("2026-01-01T00:00:00.000Z"),
    readAt: null,
    title: "Old",
    body: "Expired",
    destination: { kind: "diagnostics" },
  };
  const activeJob = {
    schemaVersion: 1,
    eventId: "active-job",
    kind: "job",
    source: "local",
    occurredAt: old.occurredAt,
    readAt: null,
    title: "Recording",
    body: "Running",
    job: { id: "job-1", state: { kind: "active" } },
    destination: { kind: "media-job", jobId: "job-1" },
  };
  const recent = [0, 1, 2].map((index) => ({
    ...old,
    eventId: `recent-${index}`,
    occurredAt: toSerializedTimestamp(
      new Date(now - index * 1_000).toISOString(),
    ),
  }));

  assert.deepEqual(
    selectRetainedActivityEventIds([old, activeJob, ...recent], {
      nowMs: now,
      maximumCompletedItems: 2,
      maximumCompletedAgeMs: 90 * 24 * 60 * 60 * 1_000,
    }),
    ["active-job", "recent-0", "recent-1"],
  );
});

test("job and system variants remain serialization-safe", () => {
  const candidates = [
    {
      schemaVersion: 1,
      eventId: "job:1",
      kind: "job",
      source: "local",
      occurredAt,
      readAt: null,
      title: "Download ready",
      body: "Open the job",
      job: { id: "job-1", state: { kind: "terminal" } },
      destination: { kind: "media-job", jobId: "job-1" },
    },
    {
      schemaVersion: 1,
      eventId: "device:ready:v1",
      kind: "system",
      event: "device-health",
      source: "local",
      occurredAt,
      readAt: null,
      title: "Mobile is ready",
      body: "Open diagnostics",
      destination: { kind: "diagnostics" },
    },
  ];

  for (const candidate of candidates) {
    assert.equal(activityItemSchema.is(candidate), true);
    assert.equal(
      activityItemSchema.is(JSON.parse(JSON.stringify(candidate))),
      true,
    );
  }
});
