import { capabilityManifestSchema } from "@streamfusion/core/relay";

import type {
  InstallationPolicySnapshotStore,
  VerifiedPolicySnapshot,
} from "../capabilities/installation-policy";

export function createProductInstallationPolicyStore(
  store: InstallationPolicySnapshotStore,
) {
  return {
    async read(): Promise<VerifiedPolicySnapshot | null> {
      const serialized = await store.read();
      return serialized === null
        ? null
        : parseVerifiedPolicySnapshot(serialized);
    },
    async write(snapshot: VerifiedPolicySnapshot): Promise<boolean> {
      const serialized = JSON.stringify(snapshot);
      await store.write(serialized, snapshot.verifiedAtEpochMs);
      return (await store.read()) === serialized;
    },
  };
}

function parseVerifiedPolicySnapshot(
  value: string,
): VerifiedPolicySnapshot | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, ["manifest", "verifiedAtEpochMs"])
    ) {
      return null;
    }
    if (!capabilityManifestSchema.is(parsed.manifest)) return null;
    if (
      typeof parsed.verifiedAtEpochMs !== "number" ||
      !Number.isSafeInteger(parsed.verifiedAtEpochMs) ||
      parsed.verifiedAtEpochMs < 0
    ) {
      return null;
    }
    return {
      manifest: parsed.manifest,
      verifiedAtEpochMs: parsed.verifiedAtEpochMs,
    };
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
