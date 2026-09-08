import type {
  SecureRandomSource,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";

import { createHttpInstallationPolicyTransport } from "../adapters/http-installation-policy-transport";
import { createTweetNaClCapabilityPolicyVerifier } from "../adapters/tweetnacl-capability-policy-verifier";
import { createUnavailableInstallationPolicyTransport } from "../adapters/unavailable-installation-policy-transport";
import { createSecureInstallationIdentityStore } from "../data/secure-installation-identity-store";
import { createProductInstallationIdentityPresenceStore } from "../data/product-installation-identity-presence-store";
import { createProductInstallationPolicyStore } from "../data/product-installation-policy-store";
import type {
  InstallationPolicyEnvironment,
  InstallationPolicySnapshotStore,
} from "../capabilities/installation-policy";

const developmentPublicKeys = {
  "development-policy-1": "ddFzjGaRKL8idoDwPELMCsVLqge1uPDzo-vt0eVh0N0",
};

export function createInstallationPolicyRuntime(input: {
  readonly productionConfiguration?: {
    readonly baseUrl: string;
    readonly trustedKeys: Readonly<Record<string, string>>;
  } | undefined;
  readonly random: SecureRandomSource;
  readonly secretStore: SecureSecretStore;
  readonly identityPresenceStore: InstallationPolicySnapshotStore;
  readonly snapshotStore: InstallationPolicySnapshotStore;
}) {
  const environment: InstallationPolicyEnvironment = __DEV__
    ? "development"
    : "production";
  const productionConfiguration = validProductionConfiguration(
    input.productionConfiguration,
  );
  const transport = __DEV__
    ? createHttpInstallationPolicyTransport({
        baseUrl: "http://10.0.2.2:8787/",
        fetch: globalThis.fetch,
      })
    : productionConfiguration === null
      ? createUnavailableInstallationPolicyTransport()
      : createHttpInstallationPolicyTransport({
          baseUrl: productionConfiguration.baseUrl,
          fetch: globalThis.fetch,
        });
  return {
    environment,
    identitySource: { create: () => input.random.uuid() },
    identityStore: createSecureInstallationIdentityStore(input.secretStore),
    identityPresenceStore: createProductInstallationIdentityPresenceStore(
      input.identityPresenceStore,
      Date.now,
    ),
    policyStore: createProductInstallationPolicyStore(input.snapshotStore),
    transport,
    verifier: createTweetNaClCapabilityPolicyVerifier({
      environment,
      trustedKeys:
        environment === "development"
          ? developmentPublicKeys
          : (productionConfiguration?.trustedKeys ?? {}),
    }),
  };
}

export function publicProductionConfigurationFromEnvironment(input: {
  readonly relayUrl: string | undefined;
  readonly trustedKeysJson: string | undefined;
}):
  | {
      readonly baseUrl: string;
      readonly trustedKeys: Readonly<Record<string, string>>;
    }
  | undefined {
  if (input.relayUrl === undefined || input.trustedKeysJson === undefined)
    return undefined;
  try {
    const parsed: unknown = JSON.parse(input.trustedKeysJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every((value) => typeof value === "string")
    ) {
      return undefined;
    }
    return {
      baseUrl: input.relayUrl,
      trustedKeys: parsed as Readonly<Record<string, string>>,
    };
  } catch {
    return undefined;
  }
}

function validProductionConfiguration(
  value:
    | {
        readonly baseUrl: string;
        readonly trustedKeys: Readonly<Record<string, string>>;
      }
    | undefined,
): {
  readonly baseUrl: string;
  readonly trustedKeys: Readonly<Record<string, string>>;
} | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value.baseUrl);
    if (
      url.protocol !== "https:" ||
      Object.keys(value.trustedKeys).length === 0
    )
      return null;
    if (
      !Object.entries(value.trustedKeys).every(
        ([keyId, key]) =>
          /^[A-Za-z0-9._:-]{1,128}$/u.test(keyId) &&
          /^[A-Za-z0-9_-]{43}$/u.test(key),
      )
    ) {
      return null;
    }
    return { baseUrl: url.toString(), trustedKeys: value.trustedKeys };
  } catch {
    return null;
  }
}
