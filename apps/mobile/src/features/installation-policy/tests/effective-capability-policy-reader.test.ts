import { describe, expect, it } from "vitest";

import type { CapabilityManifest } from "@streamfusion/core/relay";

import { createEffectiveCapabilityPolicyReader } from "../domain/effective-capability-policy-reader";

const playbackId = "compat.playback.twitch-gql-usher";

function manifest(
  capabilities: readonly string[],
  expiresAt = "2027-09-01T00:00:00.000Z",
): CapabilityManifest {
  return {
    capabilities,
    environment: "development",
    expiresAt,
    issuedAt: "2026-09-01T00:00:00.000Z",
    schemaVersion: 1,
    sequence: 4,
  };
}

describe("effective capability policy reader", () => {
  it("disables when no verified snapshot exists", async () => {
    const reader = createEffectiveCapabilityPolicyReader({
      nowEpochMs: () => Date.parse("2026-09-14T00:00:00.000Z"),
      store: { read: async () => null, write: async () => true },
    });
    await expect(reader.read(playbackId)).resolves.toEqual({
      kind: "disabled",
      reason: "no-valid-policy",
    });
  });

  it("disables omitted identifiers and expired snapshots independently", async () => {
    const omitted = createEffectiveCapabilityPolicyReader({
      nowEpochMs: () => Date.parse("2026-09-14T00:00:00.000Z"),
      store: {
        read: async () => ({
          manifest: manifest([]),
          verifiedAtEpochMs: 1,
        }),
        write: async () => true,
      },
    });
    await expect(omitted.read(playbackId)).resolves.toEqual({
      kind: "disabled",
      reason: "not-allowed",
    });

    const expired = createEffectiveCapabilityPolicyReader({
      nowEpochMs: () => Date.parse("2027-09-02T00:00:00.000Z"),
      store: {
        read: async () => ({
          manifest: manifest([playbackId], "2027-09-01T00:00:00.000Z"),
          verifiedAtEpochMs: 1,
        }),
        write: async () => true,
      },
    });
    await expect(expired.read(playbackId)).resolves.toEqual({
      kind: "disabled",
      reason: "expired",
    });
  });

  it("enables an unexpired listed identifier", async () => {
    const reader = createEffectiveCapabilityPolicyReader({
      nowEpochMs: () => Date.parse("2026-09-14T00:00:00.000Z"),
      store: {
        read: async () => ({
          manifest: manifest([playbackId]),
          verifiedAtEpochMs: 88,
        }),
        write: async () => true,
      },
    });
    await expect(reader.read(playbackId)).resolves.toEqual({
      kind: "enabled",
      sequence: 4,
      verifiedAtEpochMs: 88,
    });
  });
});
