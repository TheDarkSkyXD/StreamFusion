import type {
  EffectiveCapabilityDecision,
  EffectiveCapabilityPolicyReader,
  VerifiedPolicyStore,
} from "../capabilities/installation-policy";

export function createEffectiveCapabilityPolicyReader(input: {
  readonly nowEpochMs: () => number;
  readonly store: VerifiedPolicyStore;
}): EffectiveCapabilityPolicyReader {
  return {
    async read(capabilityId): Promise<EffectiveCapabilityDecision> {
      const snapshot = await input.store.read();
      if (snapshot === null) {
        return { kind: "disabled", reason: "no-valid-policy" };
      }
      if (Date.parse(snapshot.manifest.expiresAt) <= input.nowEpochMs()) {
        return { kind: "disabled", reason: "expired" };
      }
      if (!snapshot.manifest.capabilities.includes(capabilityId)) {
        return { kind: "disabled", reason: "not-allowed" };
      }
      return {
        kind: "enabled",
        sequence: snapshot.manifest.sequence,
        verifiedAtEpochMs: snapshot.verifiedAtEpochMs,
      };
    },
  };
}
