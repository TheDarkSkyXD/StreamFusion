import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkProductionReleaseConfig,
  materializeFirebaseConfig,
  validateProductionReleaseConfig,
} from "../scripts/firebase-release-config.mjs";

const senderId = "123456789012";
const syntheticFirebaseConfig = {
  project_info: {
    project_number: senderId,
    project_id: "synthetic-release-project",
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: `1:${senderId}:android:abcdef0123456789`,
        android_client_info: {
          package_name: "com.thedarkskyxd.streamfusion",
        },
      },
      api_key: [{ current_key: `AIza${"A".repeat(35)}` }],
    },
  ],
};

const publicConfiguration = {
  STREAMFUSION_PUBLIC_RELAY_URL: "https://relay.streamfusion.example.org/",
  STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS: JSON.stringify({
    production: "A".repeat(43),
  }),
};

test("materializes a valid production Firebase config with private permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "streamfusion-firebase-"));
  const destination = join(directory, "google-services.json");
  try {
    materializeFirebaseConfig({
      encoded: Buffer.from(JSON.stringify(syntheticFirebaseConfig)).toString("base64"),
      destination,
      environment: publicConfiguration,
    });
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), syntheticFirebaseConfig);
    assert.equal(existsSync(destination), true);
    if (process.platform !== "win32") assert.equal(statSync(destination).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production check reads the materialized file and rejects a changed client", () => {
  const directory = mkdtempSync(join(tmpdir(), "streamfusion-firebase-"));
  const source = join(directory, "google-services.json");
  try {
    assert.throws(
      () => checkProductionReleaseConfig({ source, environment: publicConfiguration }),
      /google-services\.json/u,
    );
    writeFileSync(source, JSON.stringify(syntheticFirebaseConfig));
    checkProductionReleaseConfig({ source, environment: publicConfiguration });
    writeFileSync(source, JSON.stringify({ ...syntheticFirebaseConfig, client: [] }));
    assert.throws(
      () => checkProductionReleaseConfig({ source, environment: publicConfiguration }),
      /com\.thedarkskyxd\.streamfusion/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing or malformed Firebase secret cannot create a config file", () => {
  const directory = mkdtempSync(join(tmpdir(), "streamfusion-firebase-"));
  const destination = join(directory, "google-services.json");
  try {
    for (const encoded of [undefined, "%%%", Buffer.from("not JSON").toString("base64")]) {
      assert.throws(
        () => materializeFirebaseConfig({ encoded, destination, environment: publicConfiguration }),
        /STREAMFUSION_MOBILE_GOOGLE_SERVICES_BASE64/u,
      );
      assert.equal(existsSync(destination), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production Firebase config requires the matching client and notification fields", () => {
  const invalid = [
    [{ ...syntheticFirebaseConfig, project_info: { ...syntheticFirebaseConfig.project_info, project_number: "" } }, /project_number/u],
    [{ ...syntheticFirebaseConfig, project_info: { ...syntheticFirebaseConfig.project_info, project_id: "" } }, /project_id/u],
    [{ ...syntheticFirebaseConfig, client: [] }, /com\.thedarkskyxd\.streamfusion/u],
    [{ ...syntheticFirebaseConfig, client: [{ ...syntheticFirebaseConfig.client[0], client_info: { ...syntheticFirebaseConfig.client[0].client_info, android_client_info: { package_name: "com.thedarkskyxd.streamfusion.dev" } } }] }, /com\.thedarkskyxd\.streamfusion/u],
    [{ ...syntheticFirebaseConfig, client: [{ ...syntheticFirebaseConfig.client[0], client_info: { ...syntheticFirebaseConfig.client[0].client_info, mobilesdk_app_id: "" } }] }, /mobilesdk_app_id/u],
    [{ ...syntheticFirebaseConfig, client: [{ ...syntheticFirebaseConfig.client[0], api_key: [] }] }, /api_key/u],
  ];
  for (const [config, expectedError] of invalid) {
    assert.throws(
      () => validateProductionReleaseConfig({ firebaseConfig: config, environment: publicConfiguration }),
      expectedError,
    );
  }
});

test("production relay and trusted keys cannot use development fallbacks", () => {
  const invalid = [
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_RELAY_URL: "" }, /STREAMFUSION_PUBLIC_RELAY_URL/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_RELAY_URL: "http://10.0.2.2:8787/" }, /STREAMFUSION_PUBLIC_RELAY_URL/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_RELAY_URL: "https://localhost:8787/" }, /STREAMFUSION_PUBLIC_RELAY_URL/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_RELAY_URL: "https://localhost./" }, /STREAMFUSION_PUBLIC_RELAY_URL/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS: "{}" }, /STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS: "not JSON" }, /STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS/u],
    [{ ...publicConfiguration, STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS: JSON.stringify({ production: "short" }) }, /STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS/u],
  ];
  for (const [environment, expectedError] of invalid) {
    assert.throws(
      () => validateProductionReleaseConfig({ firebaseConfig: syntheticFirebaseConfig, environment }),
      expectedError,
    );
  }
});
