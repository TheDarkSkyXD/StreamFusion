import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERIFIER_VERSION = "1.0.0";

const capabilityIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;
const gates = new Set(["change", "main", "candidate", "public-release"]);
const retentionClasses = new Set(["development", "main", "release"]);
const deviceKinds = new Set(["none", "emulator", "physical"]);
const results = new Set([
  "pass",
  "fail",
  "quarantined",
  "infrastructure-failure",
]);

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectAt(value, location) {
  if (!isObject(value)) fail(location, "must be an object");
  return value;
}

function exactKeys(value, expected, location) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    fail(location, `must contain exactly ${wanted.join(", ")}`);
  }
}

function stringAt(value, location, pattern) {
  if (typeof value !== "string" || value.length === 0)
    fail(location, "must be a string");
  if (pattern && !pattern.test(value)) fail(location, "has an invalid format");
  return value;
}

function nullableDigestAt(value, location) {
  if (value !== null) stringAt(value, location, digestPattern);
}

function dateAt(value, location) {
  stringAt(value, location);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(location, "must be an RFC 3339 UTC timestamp");
  }
  return milliseconds;
}

function arrayAt(value, location) {
  if (!Array.isArray(value)) fail(location, "must be an array");
  return value;
}

function validatePolicy(raw) {
  const policy = objectAt(raw, "policy");
  exactKeys(
    policy,
    ["schemaVersion", "retentionDays", "maximumAge", "publication"],
    "policy",
  );
  if (policy.schemaVersion !== 1) fail("policy.schemaVersion", "must equal 1");

  const retention = objectAt(policy.retentionDays, "policy.retentionDays");
  exactKeys(
    retention,
    ["development", "main", "release"],
    "policy.retentionDays",
  );
  if (
    retention.development !== 14 ||
    retention.main !== 30 ||
    retention.release !== null
  ) {
    fail(
      "policy.retentionDays",
      "must retain development for 14 days, main for 30 days, and release permanently",
    );
  }

  const maximumAge = objectAt(policy.maximumAge, "policy.maximumAge");
  exactKeys(
    maximumAge,
    [
      "exactArtifactHours",
      "liveProviderHours",
      "emulatorHours",
      "physicalDeviceDays",
      "accessibilityDays",
      "humanReviewDays",
      "signerRecoveryMonths",
    ],
    "policy.maximumAge",
  );
  const expectedMaximumAge = {
    exactArtifactHours: 24,
    liveProviderHours: 24,
    emulatorHours: 72,
    physicalDeviceDays: 7,
    accessibilityDays: 7,
    humanReviewDays: 30,
    signerRecoveryMonths: 6,
  };
  for (const [name, expected] of Object.entries(expectedMaximumAge)) {
    if (maximumAge[name] !== expected)
      fail(`policy.maximumAge.${name}`, `must equal ${expected}`);
  }

  const publication = objectAt(policy.publication, "policy.publication");
  exactKeys(
    publication,
    [
      "allowedLinkProtocols",
      "stripLinkQuery",
      "omitLocalArtifactPaths",
      "omitEnvironmentNames",
      "omitDeviceProfiles",
    ],
    "policy.publication",
  );
  if (
    JSON.stringify(publication.allowedLinkProtocols) !==
      JSON.stringify(["https:"]) ||
    publication.stripLinkQuery !== true ||
    publication.omitLocalArtifactPaths !== true ||
    publication.omitEnvironmentNames !== true ||
    publication.omitDeviceProfiles !== true
  ) {
    fail(
      "policy.publication",
      "must use the approved fail-closed publication policy",
    );
  }
  return policy;
}

function validateEnvironment(raw, location) {
  const environment = objectAt(raw, location);
  exactKeys(environment, ["gate", "retention", "name"], location);
  if (!gates.has(environment.gate))
    fail(`${location}.gate`, "is not supported");
  if (!retentionClasses.has(environment.retention))
    fail(`${location}.retention`, "is not supported");
  stringAt(environment.name, `${location}.name`);
  if (
    environment.gate === "public-release" &&
    environment.retention !== "release"
  ) {
    fail(
      `${location}.retention`,
      "must be release for the public-release gate",
    );
  }
  if (
    environment.gate === "change" &&
    environment.retention !== "development"
  ) {
    fail(`${location}.retention`, "must be development for the change gate");
  }
  return environment;
}

function validateDevice(raw, location) {
  const device = objectAt(raw, location);
  exactKeys(device, ["kind", "profile", "apiLevel"], location);
  if (!deviceKinds.has(device.kind))
    fail(`${location}.kind`, "is not supported");
  if (device.kind === "none") {
    if (device.profile !== null || device.apiLevel !== null) {
      fail(location, "must omit the profile and API level when kind is none");
    }
    return device;
  }
  stringAt(device.profile, `${location}.profile`);
  if (!Number.isInteger(device.apiLevel) || device.apiLevel < 30) {
    fail(`${location}.apiLevel`, "must be an integer at least 30");
  }
  return device;
}

function validateArtifact(raw, location) {
  const artifact = objectAt(raw, location);
  exactKeys(artifact, ["id", "path", "sha256", "mediaType"], location);
  stringAt(artifact.id, `${location}.id`, capabilityIdPattern);
  const artifactPath = stringAt(artifact.path, `${location}.path`);
  if (
    path.posix.isAbsolute(artifactPath) ||
    path.win32.isAbsolute(artifactPath) ||
    artifactPath.split(/[\\/]/u).includes("..")
  ) {
    fail(
      `${location}.path`,
      "must be repository-relative and cannot contain parent traversal",
    );
  }
  stringAt(artifact.sha256, `${location}.sha256`, digestPattern);
  stringAt(artifact.mediaType, `${location}.mediaType`);
  return artifact;
}

function validateLinks(raw, location) {
  return arrayAt(raw, location).map((value, index) => {
    const link = stringAt(value, `${location}[${index}]`);
    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      fail(`${location}[${index}]`, "must be an absolute URL");
    }
    return parsed;
  });
}

function validateRetention(record, policy, location) {
  const observedAt = dateAt(record.observedAt, `${location}.observedAt`);
  const days = policy.retentionDays[record.environment.retention];
  if (days === null) {
    if (record.expiresAt !== null)
      fail(
        `${location}.expiresAt`,
        "must be null for permanent release evidence",
      );
    return;
  }
  const expiresAt = dateAt(record.expiresAt, `${location}.expiresAt`);
  const maximumExpiry = observedAt + days * 24 * 60 * 60 * 1000;
  if (expiresAt <= observedAt || expiresAt > maximumExpiry) {
    fail(
      `${location}.expiresAt`,
      `must be after observedAt and no later than ${days} days`,
    );
  }
}

function validateEvidenceRecord(raw, policy, location) {
  const record = objectAt(raw, location);
  exactKeys(
    record,
    [
      "id",
      "sourceCommit",
      "apkDigest",
      "verifierVersion",
      "testVersion",
      "environment",
      "device",
      "artifacts",
      "result",
      "observedAt",
      "expiresAt",
      "links",
    ],
    location,
  );
  stringAt(record.id, `${location}.id`, capabilityIdPattern);
  stringAt(record.sourceCommit, `${location}.sourceCommit`, gitShaPattern);
  nullableDigestAt(record.apkDigest, `${location}.apkDigest`);
  if (record.verifierVersion !== VERIFIER_VERSION) {
    fail(`${location}.verifierVersion`, `must equal ${VERIFIER_VERSION}`);
  }
  stringAt(record.testVersion, `${location}.testVersion`);
  validateEnvironment(record.environment, `${location}.environment`);
  validateDevice(record.device, `${location}.device`);
  const artifacts = arrayAt(record.artifacts, `${location}.artifacts`);
  if (artifacts.length === 0)
    fail(`${location}.artifacts`, "must contain at least one artifact");
  const artifactIds = new Set();
  artifacts.forEach((artifact, index) => {
    const parsed = validateArtifact(
      artifact,
      `${location}.artifacts[${index}]`,
    );
    if (artifactIds.has(parsed.id))
      fail(
        `${location}.artifacts[${index}].id`,
        "must be unique within the record",
      );
    artifactIds.add(parsed.id);
  });
  if (!results.has(record.result))
    fail(`${location}.result`, "is not supported");
  validateRetention(record, policy, location);
  validateLinks(record.links, `${location}.links`);
  return record;
}

export function validateCatalog(rawCatalog, rawPolicy) {
  const policy = validatePolicy(rawPolicy);
  const catalog = objectAt(rawCatalog, "catalog");
  exactKeys(
    catalog,
    ["schemaVersion", "policyVersion", "verifierVersion", "capabilities"],
    "catalog",
  );
  if (catalog.schemaVersion !== 1)
    fail("catalog.schemaVersion", "must equal 1");
  if (catalog.policyVersion !== policy.schemaVersion) {
    fail(
      "catalog.policyVersion",
      `must equal policy schema version ${policy.schemaVersion}`,
    );
  }
  if (catalog.verifierVersion !== VERIFIER_VERSION) {
    fail("catalog.verifierVersion", `must equal ${VERIFIER_VERSION}`);
  }

  const capabilities = objectAt(catalog.capabilities, "catalog.capabilities");
  for (const capabilityId of Object.keys(capabilities)) {
    stringAt(
      capabilityId,
      `catalog.capabilities.${capabilityId}`,
      capabilityIdPattern,
    );
    const records = arrayAt(
      capabilities[capabilityId],
      `catalog.capabilities.${capabilityId}`,
    );
    const recordIds = new Set();
    records.forEach((record, index) => {
      const parsed = validateEvidenceRecord(
        record,
        policy,
        `catalog.capabilities.${capabilityId}[${index}]`,
      );
      if (recordIds.has(parsed.id)) {
        fail(
          `catalog.capabilities.${capabilityId}[${index}].id`,
          "must be unique within the capability",
        );
      }
      recordIds.add(parsed.id);
    });
  }
  return { catalog, policy };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function normalizeRecord(record) {
  return {
    ...record,
    artifacts: [...record.artifacts].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    links: [...record.links].sort(),
  };
}

function normalizeCapabilities(capabilities) {
  return Object.fromEntries(
    Object.keys(capabilities)
      .sort()
      .map((capabilityId) => [
        capabilityId,
        capabilities[capabilityId]
          .map(normalizeRecord)
          .sort((left, right) => left.id.localeCompare(right.id)),
      ]),
  );
}

function metadataFacts(artifact, metadata) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    size: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
    changedAt: metadata.ctime.toISOString(),
  };
}

async function locateArtifact(repositoryRoot, artifact) {
  const requestedPath = path.resolve(repositoryRoot, artifact.path);
  const absolutePath = await realpath(requestedPath);
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    fail(`artifact ${artifact.id}`, "resolved outside the repository");
  }
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) fail(`artifact ${artifact.id}`, "must be a file");
  return { absolutePath, facts: metadataFacts(artifact, metadata) };
}

async function verifyArtifact(artifact, located) {
  const content = await readFile(located.absolutePath);
  const actualDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actualDigest !== artifact.sha256) {
    fail(
      `artifact ${artifact.id}`,
      `digest ${actualDigest} does not match ${artifact.sha256}`,
    );
  }
  const currentFacts = metadataFacts(
    artifact,
    await stat(located.absolutePath),
  );
  if (digest(currentFacts) !== digest(located.facts)) {
    fail(`artifact ${artifact.id}`, "changed during verification");
  }
  return currentFacts;
}

function resumable(previous, fingerprint, artifactFacts) {
  return (
    previous?.fingerprint === fingerprint &&
    digest(previous.artifacts) === digest(artifactFacts)
  );
}

function publicLink(link, policy) {
  const parsed = new URL(link);
  if (!policy.publication.allowedLinkProtocols.includes(parsed.protocol))
    return null;
  if (policy.publication.stripLinkQuery) {
    parsed.search = "";
    parsed.hash = "";
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}

function redactRecord(record, policy) {
  return {
    id: record.id,
    sourceCommit: record.sourceCommit,
    apkDigest: record.apkDigest,
    verifierVersion: record.verifierVersion,
    testVersion: record.testVersion,
    environment: {
      gate: record.environment.gate,
      retention: record.environment.retention,
    },
    device: {
      kind: record.device.kind,
      apiLevel: record.device.apiLevel,
    },
    artifacts: record.artifacts.map(({ id, sha256, mediaType }) => ({
      id,
      sha256,
      mediaType,
    })),
    result: record.result,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
    links: record.links.map((link) => publicLink(link, policy)).filter(Boolean),
  };
}

async function readJson(filePath, location) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `${location}: ${error instanceof Error ? error.message : error}`,
    );
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${location}: must contain valid JSON`);
  }
}

async function readResumeState(statePath) {
  try {
    const state = await readJson(statePath, "resume state");
    if (
      !isObject(state) ||
      state.schemaVersion !== 1 ||
      state.verifierVersion !== VERIFIER_VERSION ||
      !isObject(state.completed)
    ) {
      return {
        schemaVersion: 1,
        verifierVersion: VERIFIER_VERSION,
        completed: {},
      };
    }
    return state;
  } catch {
    return {
      schemaVersion: 1,
      verifierVersion: VERIFIER_VERSION,
      completed: {},
    };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(canonicalize(value), null, 2)}\n`,
  );
  await rename(temporaryPath, filePath);
}

export async function verifyEvidenceCatalog({
  catalogPath,
  policyPath,
  statePath,
  outputPath,
  publicOutputPath,
  repositoryRoot = process.cwd(),
  resume = false,
}) {
  const [rawCatalog, rawPolicy] = await Promise.all([
    readJson(catalogPath, "catalog"),
    readJson(policyPath, "policy"),
  ]);
  const { catalog, policy } = validateCatalog(rawCatalog, rawPolicy);
  const capabilities = normalizeCapabilities(catalog.capabilities);
  const resolvedRepositoryRoot = await realpath(repositoryRoot);
  const state = resume
    ? await readResumeState(statePath)
    : { schemaVersion: 1, verifierVersion: VERIFIER_VERSION, completed: {} };
  const summary = { records: 0, verified: 0, resumed: 0, failed: 0 };
  const activeStateKeys = new Set();

  for (const [capabilityId, recordsForCapability] of Object.entries(
    capabilities,
  )) {
    for (const record of recordsForCapability) {
      summary.records += 1;
      if (record.result !== "pass") summary.failed += 1;
      const locatedArtifacts = [];
      for (const artifact of record.artifacts) {
        locatedArtifacts.push(
          await locateArtifact(resolvedRepositoryRoot, artifact),
        );
      }
      let artifactFacts = locatedArtifacts.map(({ facts }) => facts);
      const key = `${capabilityId}/${record.id}`;
      activeStateKeys.add(key);
      const fingerprint = digest({
        capabilityId,
        policyVersion: policy.schemaVersion,
        record,
      });
      if (
        resume &&
        resumable(state.completed[key], fingerprint, artifactFacts)
      ) {
        summary.resumed += 1;
      } else {
        summary.verified += 1;
        artifactFacts = [];
        for (let index = 0; index < record.artifacts.length; index += 1) {
          artifactFacts.push(
            await verifyArtifact(
              record.artifacts[index],
              locatedArtifacts[index],
            ),
          );
        }
        state.completed[key] = { fingerprint, artifacts: artifactFacts };
        await writeJson(statePath, state);
      }
    }
  }

  for (const key of Object.keys(state.completed)) {
    if (!activeStateKeys.has(key)) delete state.completed[key];
  }

  const verifiedCatalog = { ...catalog, capabilities, summary };
  const publicCatalog = {
    schemaVersion: catalog.schemaVersion,
    policyVersion: catalog.policyVersion,
    verifierVersion: catalog.verifierVersion,
    capabilities: Object.fromEntries(
      Object.entries(capabilities).map(
        ([capabilityId, recordsForCapability]) => [
          capabilityId,
          recordsForCapability.map((record) => redactRecord(record, policy)),
        ],
      ),
    ),
    summary,
  };
  await Promise.all([
    writeJson(statePath, state),
    writeJson(outputPath, verifiedCatalog),
    writeJson(publicOutputPath, publicCatalog),
  ]);

  if (summary.failed > 0) {
    throw new Error(
      `catalog contains ${summary.failed} non-passing evidence record(s)`,
    );
  }
  return summary;
}

function usage() {
  return [
    "Usage: node scripts/verify-evidence.mjs [options]",
    "  --catalog <path>",
    "  --policy <path>",
    "  --state <path>",
    "  --output <path>",
    "  --public-output <path>",
    "  --resume",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    catalogPath: path.resolve("verification/catalog.json"),
    policyPath: path.resolve("verification/evidence-policy.json"),
    statePath: path.resolve("artifacts/mobile-evidence/verifier-state.json"),
    outputPath: path.resolve("artifacts/mobile-evidence/verified-catalog.json"),
    publicOutputPath: path.resolve(
      "artifacts/mobile-evidence/public-index.json",
    ),
    repositoryRoot: process.cwd(),
    resume: false,
  };
  const pathArguments = new Map([
    ["--catalog", "catalogPath"],
    ["--policy", "policyPath"],
    ["--state", "statePath"],
    ["--output", "outputPath"],
    ["--public-output", "publicOutputPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--resume") {
      options.resume = true;
      continue;
    }
    if (argument === "--help") return null;
    const field = pathArguments.get(argument);
    const value = argv[index + 1];
    if (!field || !value)
      throw new Error(`unknown or incomplete argument: ${argument}`);
    options[field] = path.resolve(value);
    index += 1;
  }
  return options;
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    return;
  }
  const summary = await verifyEvidenceCatalog(options);
  console.log(
    `Evidence verification passed. ${summary.verified} verified, ${summary.resumed} resumed, ${summary.records} total.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
