import type { SignedCapabilityManifest } from "@streamfusion/core/relay";

/** Public development fixture only. The matching signing private key is never in Relay. */
export const developmentCapabilityManifest: SignedCapabilityManifest = {
  algorithm: "ed25519",
  keyId: "development-policy-1",
  manifest: {
    capabilities: [],
    environment: "development",
    expiresAt: "2027-09-01T00:00:00.000Z",
    issuedAt: "2026-09-01T00:00:00.000Z",
    schemaVersion: 1,
    sequence: 1
  },
  signature:
    "XgO146XEP-yE1gMW-gpm7qZeCl_SK1oIxa4AuRVeHm6fyOJ5rMBjDvtCAnTCbGvggGvjR1f1-iIARmwhF6yvAw"
};
