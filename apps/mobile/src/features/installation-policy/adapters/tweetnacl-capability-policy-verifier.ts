import nacl from "tweetnacl";

import {
  canonicalizeCapabilityManifest,
  signedCapabilityManifestSchema,
} from "@streamfusion/core/relay";

import type {
  CapabilityPolicyVerifier,
  InstallationPolicyEnvironment,
} from "../capabilities/installation-policy";
import { decodeBase64Url } from "../utils/base64url";

export function createTweetNaClCapabilityPolicyVerifier(input: {
  readonly environment: InstallationPolicyEnvironment;
  readonly trustedKeys: Readonly<Record<string, string>>;
}): CapabilityPolicyVerifier {
  return {
    verify({ environment, nowEpochMs, payload, previousManifest }) {
      if (!signedCapabilityManifestSchema.is(payload)) {
        return { kind: "invalid", reason: "schema" };
      }
      if (
        environment !== input.environment ||
        payload.manifest.environment !== environment
      ) {
        return { kind: "invalid", reason: "environment" };
      }
      const encodedPublicKey = Object.hasOwn(input.trustedKeys, payload.keyId)
        ? input.trustedKeys[payload.keyId]
        : undefined;
      if (typeof encodedPublicKey !== "string") {
        return { kind: "invalid", reason: "signature" };
      }
      if (Date.parse(payload.manifest.issuedAt) > nowEpochMs) {
        return { kind: "invalid", reason: "issued-time" };
      }
      if (Date.parse(payload.manifest.expiresAt) <= nowEpochMs) {
        return { kind: "invalid", reason: "expiry" };
      }
      if (
        previousManifest !== null &&
        (payload.manifest.sequence < previousManifest.sequence ||
          (payload.manifest.sequence === previousManifest.sequence &&
            canonicalizeCapabilityManifest(payload.manifest) !==
              canonicalizeCapabilityManifest(previousManifest)))
      ) {
        return { kind: "invalid", reason: "monotonic-version" };
      }

      const publicKey = decodeBase64Url(encodedPublicKey);
      const signature = decodeBase64Url(payload.signature);
      if (
        publicKey?.length !== nacl.sign.publicKeyLength ||
        signature?.length !== nacl.sign.signatureLength
      ) {
        return { kind: "invalid", reason: "signature" };
      }
      const message = new TextEncoder().encode(
        canonicalizeCapabilityManifest(payload.manifest),
      );
      if (!nacl.sign.detached.verify(message, signature, publicKey)) {
        return { kind: "invalid", reason: "signature" };
      }

      return { kind: "valid", manifest: payload.manifest };
    },
  };
}
