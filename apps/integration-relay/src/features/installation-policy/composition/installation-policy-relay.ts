import { developmentCapabilityManifest } from "../adapters/development-capability-manifest";
import {
  signedCapabilityManifestSchema,
  type SignedCapabilityManifest
} from "@streamfusion/core/relay";
import { createHmacInstallationCredentialAuthority } from "../adapters/hmac-installation-credential-authority";
import { createD1InstallationRegistry } from "../data/d1-installation-registry";
import { createD1RelayRateLimiter } from "../data/d1-relay-rate-limiter";
import { createInstallationService } from "../domain/installation-service";
import { createInstallationPolicyRoute } from "../routes/installation-policy-route";
import type { RelayEnvironment } from "../capabilities/installation-registry";

export function createInstallationPolicyRelayRoute(input: {
  readonly credentialSecret: string;
  readonly database: D1Database;
  readonly environment: RelayEnvironment;
  readonly manifest: SignedCapabilityManifest | null;
  readonly now: () => number;
}) {
  return createInstallationPolicyRoute({
    manifest:
      input.manifest ??
      (input.environment === "development"
        ? developmentCapabilityManifest
        : null),
    now: input.now,
    rateLimiter: createD1RelayRateLimiter(input.database),
    service: createInstallationService({
      authority: createHmacInstallationCredentialAuthority({
        secret: input.credentialSecret
      }),
      environment: input.environment,
      now: input.now,
      registry: createD1InstallationRegistry(input.database)
    })
  });
}

export function parseConfiguredManifest(
  serialized: string | undefined,
  environment: RelayEnvironment
): SignedCapabilityManifest | null {
  if (serialized === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return signedCapabilityManifestSchema.is(parsed) &&
      parsed.manifest.environment === environment
      ? parsed
      : null;
  } catch {
    return null;
  }
}
