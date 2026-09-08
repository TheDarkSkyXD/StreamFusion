import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeCapabilityManifest,
  capabilityManifestSchema,
  installationCredentialGrantSchema,
  installationRegistrationRequestSchema,
  installationRotationRequestSchema,
  signedCapabilityManifestSchema,
} from "@streamfusion/core/relay";

const manifest = {
  capabilities: ["kick.public-read"],
  environment: "development",
  expiresAt: "2026-09-08T01:00:00.000Z",
  issuedAt: "2026-09-08T00:00:00.000Z",
  schemaVersion: 1,
  sequence: 7,
};

test("capability manifest parsing accepts an exact, ordered policy", () => {
  assert.equal(capabilityManifestSchema.is(manifest), true);
  assert.equal(
    canonicalizeCapabilityManifest(manifest),
    '{"capabilities":["kick.public-read"],"environment":"development","expiresAt":"2026-09-08T01:00:00.000Z","issuedAt":"2026-09-08T00:00:00.000Z","schemaVersion":1,"sequence":7}',
  );
});

test("capability manifest parsing rejects policy expansion and temporal ambiguity", () => {
  assert.equal(
    capabilityManifestSchema.is({
      ...manifest,
      capabilities: ["duplicate", "duplicate"],
    }),
    false,
  );
  assert.equal(
    capabilityManifestSchema.is({ ...manifest, expiresAt: manifest.issuedAt }),
    false,
  );
  assert.equal(
    capabilityManifestSchema.is({ ...manifest, sequence: 0 }),
    false,
  );
  assert.equal(
    capabilityManifestSchema.is({ ...manifest, unknown: true }),
    false,
  );
});

test("signed manifest parsing accepts only a complete detached Ed25519 envelope", () => {
  const signed = {
    algorithm: "ed25519",
    keyId: "development-policy-1",
    manifest,
    signature: "A".repeat(86),
  };
  assert.equal(signedCapabilityManifestSchema.is(signed), true);
  assert.equal(
    signedCapabilityManifestSchema.is({
      ...signed,
      signature: "not-a-signature",
    }),
    false,
  );
  assert.equal(
    signedCapabilityManifestSchema.is({ ...signed, algorithm: "rsa" }),
    false,
  );
});

test("installation registration and credential grants remain exact serialized contracts", () => {
  const registration = {
    environment: "development",
    installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
    registrationId: "register-95B4xv59NSmcKQz33cAj9g",
  };
  const grant = {
    credential: "A".repeat(43),
    credentialExpiresAt: "2026-09-08T01:00:00.000Z",
    generation: 2,
    reconciledAt: "2026-09-08T00:00:00.000Z",
  };

  assert.equal(installationRegistrationRequestSchema.is(registration), true);
  assert.equal(installationCredentialGrantSchema.is(grant), true);
  assert.equal(
    installationCredentialGrantSchema.is({ ...grant, generation: 0 }),
    false,
  );
  assert.equal(
    installationCredentialGrantSchema.is({
      ...grant,
      credential: `v1.${"A".repeat(43)}.${"B".repeat(43)}`,
    }),
    true,
  );
  assert.equal(
    installationRegistrationRequestSchema.is({
      ...registration,
      fcmToken: "x",
    }),
    false,
  );
  assert.equal(
    installationRegistrationRequestSchema.is({
      ...registration,
      registrationId: "short",
    }),
    false,
  );
  assert.equal(
    installationRotationRequestSchema.is({
      rotationId: "rotate-95B4xv59NSmcKQz33cAj9g",
    }),
    true,
  );
});
