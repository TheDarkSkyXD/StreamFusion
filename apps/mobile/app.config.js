const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const RELEASE_CHANNEL_VARIABLE = "STREAMFUSION_RELEASE_CHANNEL";
const PRODUCTION_PROJECT_VARIABLE = "STREAMFUSION_PRODUCTION_EAS_PROJECT_ID";
const PRODUCTION_OWNER_VARIABLE = "STREAMFUSION_PRODUCTION_EAS_OWNER";
const PRODUCTION_VERSION_VARIABLE = "STREAMFUSION_PRODUCTION_VERSION";
const PRODUCTION_VERSION_CODE_VARIABLE = "STREAMFUSION_PRODUCTION_VERSION_CODE";
const FINGERPRINT_PATH = path.join(
  __dirname,
  "config",
  "production-signing-certificate.json",
);

const PRODUCTION_APPLICATION_ID = "com.thedarkskyxd.streamfusion";
const IDENTITIES = Object.freeze({
  "com.thedarkskyxd.streamfusion.dev": Object.freeze({
    channel: "development",
    name: "StreamFusion Development",
    slug: "streamfusion-development",
    scheme: "streamfusion-development",
  }),
  [PRODUCTION_APPLICATION_ID]: Object.freeze({
    channel: "production",
    name: "StreamFusion",
    slug: "streamfusion",
    scheme: "streamfusion",
  }),
});

const PRODUCTION_IDENTITY = IDENTITIES[PRODUCTION_APPLICATION_ID];
const RELEASE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const PRODUCTION_ENVIRONMENT = Object.freeze({
  projectId: Object.freeze({
    variable: PRODUCTION_PROJECT_VARIABLE,
    pattern: /^[0-9a-f-]{36}$/u,
    label: "Expo project id",
  }),
  owner: Object.freeze({
    variable: PRODUCTION_OWNER_VARIABLE,
    pattern: /^[a-z0-9-]+$/u,
    label: "Expo account name",
  }),
  version: Object.freeze({
    variable: PRODUCTION_VERSION_VARIABLE,
    pattern: RELEASE_VERSION_PATTERN,
    label: "release version",
  }),
  versionCode: Object.freeze({
    variable: PRODUCTION_VERSION_CODE_VARIABLE,
    pattern: /^[1-9]\d*$/u,
    label: "Android version code",
  }),
});

function readCommittedDevelopmentConfig() {
  return JSON.parse(
    readFileSync(path.join(__dirname, "app.json"), "utf8"),
  ).expo;
}

function requireProductionValue(environment, requirement) {
  const value = environment[requirement.variable];
  if (!value) {
    throw new Error(
      `A production Android build requires ${requirement.variable}. A production build never inherits the ${requirement.label} from the development identity, because an APK that silently reused the development package, version, or Expo project could not be installed or verified.`,
    );
  }
  if (!requirement.pattern.test(value)) {
    throw new Error(
      `${requirement.variable} is not a valid ${requirement.label}: ${value}`,
    );
  }
  return value;
}

function resolveProductionEnvironment(environment) {
  return {
    projectId: requireProductionValue(
      environment,
      PRODUCTION_ENVIRONMENT.projectId,
    ),
    owner: requireProductionValue(environment, PRODUCTION_ENVIRONMENT.owner),
    version: requireProductionValue(environment, PRODUCTION_ENVIRONMENT.version),
    versionCode: Number(
      requireProductionValue(environment, PRODUCTION_ENVIRONMENT.versionCode),
    ),
  };
}

function assertIdentityIsCoherent(config) {
  const identity = IDENTITIES[config.android?.package];
  if (!identity) {
    throw new Error(
      `Unknown StreamFusion Android application id: ${config.android?.package}`,
    );
  }
  for (const field of ["name", "slug", "scheme"]) {
    if (config[field] !== identity[field]) {
      throw new Error(
        `Resolved Expo config pairs the ${config.android.package} application id with ${field}=${config[field]}, but that identity requires ${identity[field]}. A partial identity switch ships an APK whose name, deep links, and package disagree.`,
      );
    }
  }
  return identity;
}

function assertProductionSignerIsPinned() {
  const { certificateSha256 } = existsSync(FINGERPRINT_PATH)
    ? JSON.parse(readFileSync(FINGERPRINT_PATH, "utf8"))
    : {};
  if (!FINGERPRINT_PATTERN.test(certificateSha256 ?? "")) {
    throw new Error(
      `No production signing certificate is pinned at ${path.relative(__dirname, FINGERPRINT_PATH)}, so no production Android build is authorized. Android accepts an update only when the signing certificate matches, and an unpinned signer cannot be verified before publication. Run npm run verify:release -- --pin <sha256> <recorded-by> once the StreamFusion Mobile production key exists.`,
    );
  }
}

function resolveConfig(config, environment) {
  if (environment[RELEASE_CHANNEL_VARIABLE] !== "production") return config;

  const production = resolveProductionEnvironment(environment);
  assertProductionSignerIsPinned();

  return {
    ...config,
    name: PRODUCTION_IDENTITY.name,
    slug: PRODUCTION_IDENTITY.slug,
    scheme: PRODUCTION_IDENTITY.scheme,
    version: production.version,
    owner: production.owner,
    android: {
      ...config.android,
      package: PRODUCTION_APPLICATION_ID,
      versionCode: production.versionCode,
    },
    extra: { ...config.extra, eas: { projectId: production.projectId } },
  };
}

function resolveAppConfig({ config } = {}, environment = process.env) {
  const committed = readCommittedDevelopmentConfig();
  const resolved = resolveConfig(config ?? committed, environment);
  const identity = assertIdentityIsCoherent(resolved);

  if (identity.channel === "development") {
    for (const field of ["name", "slug", "scheme", "version"]) {
      if (resolved[field] !== committed[field]) {
        throw new Error(
          `Resolved development ${field} ${resolved[field]} does not match the committed app.json value ${committed[field]}. app.json is the single source of truth for the development identity.`,
        );
      }
    }
    if (resolved.android.versionCode !== committed.android.versionCode) {
      throw new Error(
        `Resolved development versionCode ${resolved.android.versionCode} does not match the committed app.json value ${committed.android.versionCode}.`,
      );
    }
  }

  return resolved;
}

module.exports = resolveAppConfig;
