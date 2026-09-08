import { describe, expect, it } from "vitest";

import { createTweetNaClCapabilityPolicyVerifier } from "../adapters/tweetnacl-capability-policy-verifier";

const publicKey = "ddFzjGaRKL8idoDwPELMCsVLqge1uPDzo-vt0eVh0N0";
const manifest = {
  capabilities: [],
  environment: "development" as const,
  expiresAt: "2027-09-01T00:00:00.000Z",
  issuedAt: "2026-09-01T00:00:00.000Z",
  schemaVersion: 1 as const,
  sequence: 1,
};
const payload = {
  algorithm: "ed25519" as const,
  keyId: "development-policy-1",
  manifest,
  signature:
    "XgO146XEP-yE1gMW-gpm7qZeCl_SK1oIxa4AuRVeHm6fyOJ5rMBjDvtCAnTCbGvggGvjR1f1-iIARmwhF6yvAw",
};

function verify(payloadToVerify: unknown, previousManifest = null) {
  return createTweetNaClCapabilityPolicyVerifier({
    environment: "development",
    trustedKeys: { "development-policy-1": publicKey },
  }).verify({
    environment: "development",
    nowEpochMs: Date.parse("2026-09-07T00:00:00.000Z"),
    payload: payloadToVerify,
    previousManifest,
  });
}

describe("TweetNaCl capability policy verification", () => {
  it("accepts the canonical independently signed development fixture", () => {
    expect(verify(payload)).toEqual({ kind: "valid", manifest });
  });

  it("rejects a future-issued candidate before it can replace a valid policy", () => {
    expect(
      verify({
        ...payload,
        manifest: { ...manifest, issuedAt: "2026-10-01T00:00:00.000Z" },
      }),
    ).toEqual({ kind: "invalid", reason: "issued-time" });
  });

  it("rejects expired and wrong-environment candidates before signature activation", () => {
    expect(
      verify({
        ...payload,
        manifest: { ...manifest, expiresAt: "2026-09-06T00:00:00.000Z" },
      }),
    ).toEqual({ kind: "invalid", reason: "expiry" });
    expect(
      verify({
        ...payload,
        manifest: { ...manifest, environment: "production" },
      }),
    ).toEqual({ kind: "invalid", reason: "environment" });
  });

  it("rejects malformed and wrong-length detached signatures", () => {
    expect(verify({ ...payload, signature: "A".repeat(86) })).toEqual({
      kind: "invalid",
      reason: "signature",
    });
    expect(verify({ ...payload, signature: "A".repeat(85) })).toEqual({
      kind: "invalid",
      reason: "signature",
    });
  });

  it("contains unknown and inherited key IDs as invalid signatures", () => {
    expect(verify({ ...payload, keyId: "unknown-policy-1" })).toEqual({
      kind: "invalid",
      reason: "signature",
    });
    expect(verify({ ...payload, keyId: "constructor" })).toEqual({
      kind: "invalid",
      reason: "signature",
    });
    expect(verify({ ...payload, keyId: "__proto__" })).toEqual({
      kind: "invalid",
      reason: "signature",
    });
  });

  it("rejects a same-sequence substitution while retaining the caller-owned valid policy", () => {
    const candidate = {
      ...payload,
      manifest: { ...manifest, capabilities: ["kick.public-read"] },
    };
    expect(verify(candidate, manifest)).toEqual({
      kind: "invalid",
      reason: "monotonic-version",
    });
  });

  it("rejects a lower signed sequence than the caller-owned valid policy", () => {
    expect(verify(payload, { ...manifest, sequence: 2 })).toEqual({
      kind: "invalid",
      reason: "monotonic-version",
    });
  });
});
