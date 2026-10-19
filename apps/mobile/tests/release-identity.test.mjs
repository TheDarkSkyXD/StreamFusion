import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { after } from "node:test";

const resolveNativeConfig = createRequire(import.meta.url)(
  "../native-config.cjs",
);
const committed = JSON.parse(readFileSync("native-config.json", "utf8"));
const PRODUCTION_APPLICATION_ID = "com.thedarkskyxd.streamfusion";
const CERTIFICATE_PATH = "config/production-signing-certificate.json";
const committedCertificate = readFileSync(CERTIFICATE_PATH, "utf8");

after(() => writeFileSync(CERTIFICATE_PATH, committedCertificate));

function pinTestCertificate(overrides = {}) {
  writeFileSync(
    CERTIFICATE_PATH,
    JSON.stringify({
      ...JSON.parse(committedCertificate),
      certificateSha256: "a".repeat(64),
      recordedBy: "release-identity test fixture",
      recordedAt: "2026-09-30",
      ...overrides,
    }),
  );
}

function productionEnvironment(overrides = {}) {
  return {
    STREAMFUSION_RELEASE_CHANNEL: "production",
    STREAMFUSION_PRODUCTION_VERSION: "1.0.0",
    STREAMFUSION_PRODUCTION_VERSION_CODE: "1",
    ...overrides,
  };
}

test("the committed native config stays on the development identity", () => {
  const resolved = resolveNativeConfig({}, {});
  assert.equal(resolved.name, "StreamFusion Development");
  assert.equal(resolved.slug, "streamfusion-development");
  assert.equal(resolved.scheme, "streamfusion-development");
  assert.equal(resolved.android.package, "com.thedarkskyxd.streamfusion.dev");
  assert.equal(resolved.version, "0.1.15");
  assert.equal(resolved.android.versionCode, 18);
  assert.deepEqual(resolved, committed);
});

test("only the exact production channel switches identity", () => {
  for (const channel of [
    undefined,
    "",
    "development",
    "staging",
    "Production",
  ]) {
    const environment = productionEnvironment();
    if (channel === undefined) delete environment.STREAMFUSION_RELEASE_CHANNEL;
    else environment.STREAMFUSION_RELEASE_CHANNEL = channel;
    assert.equal(
      resolveNativeConfig({}, environment).android.package,
      "com.thedarkskyxd.streamfusion.dev",
    );
  }
});

test("production uses its own package and version", () => {
  pinTestCertificate();
  const resolved = resolveNativeConfig({}, productionEnvironment());
  assert.equal(resolved.name, "StreamFusion");
  assert.equal(resolved.scheme, "streamfusion");
  assert.equal(resolved.android.package, PRODUCTION_APPLICATION_ID);
  assert.equal(resolved.version, "1.0.0");
  assert.equal(resolved.android.versionCode, 1);
});

test("production requires both version values", () => {
  pinTestCertificate();
  for (const variable of [
    "STREAMFUSION_PRODUCTION_VERSION",
    "STREAMFUSION_PRODUCTION_VERSION_CODE",
  ]) {
    const environment = productionEnvironment();
    delete environment[variable];
    assert.throws(
      () => resolveNativeConfig({}, environment),
      new RegExp(variable, "u"),
    );
  }
});

test("malformed production versions fail the build", () => {
  pinTestCertificate();
  for (const version of [
    "one",
    "1.0",
    "1.0.0.0",
    "v1.0.0",
    "1.0.0-nightly.1",
  ]) {
    assert.throws(
      () =>
        resolveNativeConfig(
          {},
          productionEnvironment({ STREAMFUSION_PRODUCTION_VERSION: version }),
        ),
      /STREAMFUSION_PRODUCTION_VERSION/u,
    );
  }
  for (const versionCode of ["0", "-1", "01x", "9007199254740992"]) {
    assert.throws(
      () =>
        resolveNativeConfig(
          {},
          productionEnvironment({
            STREAMFUSION_PRODUCTION_VERSION_CODE: versionCode,
          }),
        ),
      /STREAMFUSION_PRODUCTION_VERSION_CODE/u,
    );
  }
});

test("every accepted mobile release tag can be built", async () => {
  const { validateMobileReleaseTag } =
    await import("../../../scripts/release-policy.mjs");
  pinTestCertificate();
  for (const version of [
    "0.1.0-alpha",
    "0.1.0-alpha.1",
    "1.0.0-rc.2",
    "2.0.0",
  ]) {
    assert.doesNotThrow(() =>
      validateMobileReleaseTag({ tag: `android-v${version}`, version }),
    );
    assert.equal(
      resolveNativeConfig(
        {},
        productionEnvironment({ STREAMFUSION_PRODUCTION_VERSION: version }),
      ).version,
      version,
    );
  }
});

test("development rejects a half-switched identity", () => {
  assert.throws(
    () =>
      resolveNativeConfig(
        {
          config: {
            ...committed,
            android: {
              ...committed.android,
              package: PRODUCTION_APPLICATION_ID,
            },
          },
        },
        {},
      ),
    /Development identity must match native-config.json/u,
  );
});

test("the certificate pins the public application identity and signer", () => {
  const pinned = JSON.parse(committedCertificate);
  assert.equal(pinned.applicationId, PRODUCTION_APPLICATION_ID);
  assert.match(String(pinned.certificateSha256), /^[0-9a-f]{64}$/u);
  assert.ok(pinned.recordedBy);
  assert.match(String(pinned.recordedAt), /^\d{4}-\d{2}-\d{2}$/u);
});

test("production refuses an unpinned signer", () => {
  pinTestCertificate({ certificateSha256: null });
  assert.throws(
    () => resolveNativeConfig({}, productionEnvironment()),
    /production signing certificate must be pinned/iu,
  );
});

test("production refuses a certificate pinned for another application", () => {
  pinTestCertificate({ applicationId: "com.example.unrelated" });
  assert.throws(
    () => resolveNativeConfig({}, productionEnvironment()),
    /certificate|application id/iu,
  );
});
