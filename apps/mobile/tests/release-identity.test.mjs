import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { after } from "node:test";

const require = createRequire(import.meta.url);
const resolveAppConfig = require("../app.config.js");

const easManifest = JSON.parse(readFileSync("eas.json", "utf8"));
const appManifest = JSON.parse(readFileSync("app.json", "utf8")).expo;
const productionProfile = easManifest.build.production;
const PRODUCTION_APPLICATION_ID = "com.thedarkskyxd.streamfusion";
const CERTIFICATE_PATH = "config/production-signing-certificate.json";
const committedCertificate = readFileSync(CERTIFICATE_PATH, "utf8");

after(() => writeFileSync(CERTIFICATE_PATH, committedCertificate));

function pinTestCertificate() {
  writeFileSync(
    CERTIFICATE_PATH,
    JSON.stringify({
      ...JSON.parse(committedCertificate),
      certificateSha256: "a".repeat(64),
      recordedBy: "release-identity test fixture",
      recordedAt: "2026-09-30",
    }),
  );
}

function unpinTestCertificate() {
  writeFileSync(CERTIFICATE_PATH, committedCertificate);
}

function productionEnvironment(overrides = {}) {
  return {
    STREAMFUSION_RELEASE_CHANNEL: "production",
    STREAMFUSION_PRODUCTION_EAS_PROJECT_ID: "11111111-2222-3333-4444-555555555555",
    STREAMFUSION_PRODUCTION_EAS_OWNER: "streamfusion",
    STREAMFUSION_PRODUCTION_VERSION: "1.0.0",
    STREAMFUSION_PRODUCTION_VERSION_CODE: "1",
    ...overrides,
  };
}

test("the committed app.json stays the development identity", () => {
  const resolved = resolveAppConfig({}, {});

  assert.equal(resolved.name, "StreamFusion Development");
  assert.equal(resolved.slug, "streamfusion-development");
  assert.equal(resolved.scheme, "streamfusion-development");
  assert.equal(resolved.android.package, "com.thedarkskyxd.streamfusion.dev");
  assert.equal(resolved.version, appManifest.version);
  assert.equal(resolved.android.versionCode, appManifest.android.versionCode);
});

test("an unset release channel never resolves the production identity", () => {
  for (const channel of [undefined, "", "development", "staging", "Production"]) {
    const environment = productionEnvironment();
    delete environment.STREAMFUSION_RELEASE_CHANNEL;
    if (channel !== undefined) {
      environment.STREAMFUSION_RELEASE_CHANNEL = channel;
    }

    const resolved = resolveAppConfig({}, environment);
    assert.equal(
      resolved.android.package,
      "com.thedarkskyxd.streamfusion.dev",
      `channel ${String(channel)} must not select production`,
    );
  }
});

test("a production build resolves the public application id and its own version", () => {
  pinTestCertificate();
  const resolved = resolveAppConfig({}, productionEnvironment());

  assert.equal(resolved.name, "StreamFusion");
  assert.equal(resolved.slug, "streamfusion");
  assert.equal(resolved.scheme, "streamfusion");
  assert.equal(resolved.android.package, PRODUCTION_APPLICATION_ID);
  assert.equal(resolved.version, "1.0.0");
  assert.equal(resolved.android.versionCode, 1);
  assert.equal(resolved.owner, "streamfusion");
  assert.equal(
    resolved.extra.eas.projectId,
    "11111111-2222-3333-4444-555555555555",
  );
});

test("the production build never inherits a development value", () => {
  pinTestCertificate();
  const variables = [
    "STREAMFUSION_PRODUCTION_EAS_PROJECT_ID",
    "STREAMFUSION_PRODUCTION_EAS_OWNER",
    "STREAMFUSION_PRODUCTION_VERSION",
    "STREAMFUSION_PRODUCTION_VERSION_CODE",
  ];

  for (const variable of variables) {
    const environment = productionEnvironment();
    delete environment[variable];

    assert.throws(
      () => resolveAppConfig({}, environment),
      new RegExp(variable, "u"),
      `missing ${variable} must fail the production build`,
    );
  }
});

test("a malformed production value fails the build instead of shipping", () => {
  pinTestCertificate();
  const cases = [
    [{ STREAMFUSION_PRODUCTION_VERSION: "one" }],
    [{ STREAMFUSION_PRODUCTION_VERSION: "1.0" }],
    [{ STREAMFUSION_PRODUCTION_VERSION: "1.0.0.0" }],
    [{ STREAMFUSION_PRODUCTION_VERSION_CODE: "0" }],
    [{ STREAMFUSION_PRODUCTION_VERSION_CODE: "-1" }],
    [{ STREAMFUSION_PRODUCTION_VERSION_CODE: "01x" }],
    [{ STREAMFUSION_PRODUCTION_EAS_PROJECT_ID: "not-a-uuid" }],
    [{ STREAMFUSION_PRODUCTION_EAS_OWNER: "StreamFusion Org" }],
  ];

  for (const [override] of cases) {
    assert.throws(
      () => resolveAppConfig({}, productionEnvironment(override)),
      /STREAMFUSION_PRODUCTION/u,
      `${JSON.stringify(override)} must fail the production build`,
    );
  }
});

test("a prerelease suffix is accepted and a bare major is not", () => {
  pinTestCertificate();
  for (const version of ["1.0.0", "1.0.0-rc.1", "2.1.3-beta.4", "1.0.0-alpha.1"]) {
    const resolved = resolveAppConfig(
      {},
      productionEnvironment({ STREAMFUSION_PRODUCTION_VERSION: version }),
    );
    assert.equal(resolved.version, version);
  }
  for (const version of ["1.0", "1.0.0-nightly.1", "v1.0.0", "1.0.0-rc"]) {
    assert.throws(
      () =>
        resolveAppConfig(
          {},
          productionEnvironment({ STREAMFUSION_PRODUCTION_VERSION: version }),
        ),
      /STREAMFUSION_PRODUCTION_VERSION/u,
    );
  }
});

test("a half-switched identity is rejected", () => {
  const committed = JSON.parse(readFileSync("app.json", "utf8")).expo;

  assert.throws(
    () =>
      resolveAppConfig({
        config: {
          ...committed,
          name: "StreamFusion",
          scheme: "streamfusion-development",
          android: {
            ...committed.android,
            package: PRODUCTION_APPLICATION_ID,
            versionCode: 9,
          },
        },
      }),
    /identity switch/u,
  );
});

test("a production build cannot present the development package to Android", () => {
  const committed = JSON.parse(readFileSync("app.json", "utf8")).expo;
  const environment = productionEnvironment();
  delete environment.STREAMFUSION_PRODUCTION_VERSION_CODE;

  assert.throws(
    () =>
      resolveAppConfig(
        {
          config: {
            ...committed,
            android: {
              ...committed.android,
              package: "com.thedarkskyxd.streamfusion.dev",
            },
          },
        },
        environment,
      ),
    /STREAMFUSION_PRODUCTION_VERSION_CODE/u,
  );
});

test("an unknown application id is rejected", () => {
  const committed = JSON.parse(readFileSync("app.json", "utf8")).expo;

  assert.throws(
    () =>
      resolveAppConfig(
        {
          config: {
            ...committed,
            android: { ...committed.android, package: "com.example.streamfusion" },
          },
        },
        {},
      ),
    /Unknown StreamFusion Android application id/u,
  );
});

test("a production build is refused until the signing certificate is pinned", () => {
  unpinTestCertificate();
  assert.throws(
    () => resolveAppConfig({}, productionEnvironment()),
    /no production Android build is authorized|signing certificate is not pinned/iu,
  );
});

test("the committed certificate records the public application id and no fingerprint yet", () => {
  const pinned = JSON.parse(
    readFileSync("config/production-signing-certificate.json", "utf8"),
  );

  assert.equal(pinned.applicationId, PRODUCTION_APPLICATION_ID);
  assert.equal(
    pinned.certificateSha256,
    null,
    "the repository ships without a production signer, so production builds fail closed",
  );
});

test("a production build succeeds once the certificate is pinned", () => {
  pinTestCertificate();
  const resolved = resolveAppConfig({}, productionEnvironment());
  assert.equal(resolved.android.package, PRODUCTION_APPLICATION_ID);
  assert.equal(resolved.version, "1.0.0");
});

test("the production EAS profile is pinned and internal", () => {
  assert.ok(productionProfile, "eas.json must declare a production build profile");
  assert.equal(productionProfile.developmentClient, false);
  assert.equal(productionProfile.distribution, "internal");
  assert.equal(productionProfile.autoIncrement, false);
  assert.equal(productionProfile.android.buildType, "apk");
  assert.equal(productionProfile.node, "22.14.0");
  assert.equal(
    productionProfile.env.STREAMFUSION_RELEASE_CHANNEL,
    "production",
    "the production profile must select the production identity",
  );
  assert.match(
    productionProfile.image,
    /^ubuntu-\d+\.\d+-jdk-17-ndk-r\d+[a-z]?-sdk-57$/u,
    "production must pin a named SDK 57 image rather than latest, auto, or an alias",
  );
  assert.equal(
    easManifest.cli.appVersionSource,
    "local",
    "the release commit records the shipped versionCode",
  );
  assert.equal(easManifest.cli.requireCommit, true);
});

test("the development and alpha profiles never select the production identity", () => {
  for (const name of ["development", "alpha"]) {
    assert.notEqual(
      easManifest.build[name].env?.STREAMFUSION_RELEASE_CHANNEL,
      "production",
      `the ${name} profile must keep building the development identity`,
    );
  }
});
