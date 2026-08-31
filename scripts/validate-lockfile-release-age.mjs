import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pacote from "pacote";

const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const REGISTRY_CONCURRENCY = 16;

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function createPackagePublicationLookup({
  packument = pacote.packument,
} = {}) {
  const requests = new Map();

  return (name, { refresh = false } = {}) => {
    const requestKey = `${refresh ? "online" : "offline"}:${name}`;
    if (!requests.has(requestKey)) {
      requests.set(
        requestKey,
        packument(name, {
          registry: DEFAULT_REGISTRY,
          fullMetadata: true,
          ...(refresh ? { preferOnline: true } : { preferOffline: true }),
        }).then((metadata) => {
          if (!metadata?.time || typeof metadata.time !== "object") {
            throw new Error(
              `Registry response for ${name} has no publication times`,
            );
          }
          return metadata.time;
        }),
      );
    }
    return requests.get(requestKey);
  };
}

function packageNameFromLockPath(packagePath) {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const segments = packagePath.slice(markerIndex + marker.length).split("/");
  if (segments[0].startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] || null;
}

function registryPackageNameFromResolved(resolved) {
  try {
    const url = new URL(resolved);
    if (url.origin !== DEFAULT_REGISTRY) return null;
    const separator = url.pathname.indexOf("/-/");
    if (separator === -1) return null;
    return decodeURIComponent(url.pathname.slice(1, separator));
  } catch {
    return null;
  }
}

function packageVersionSeparator(packageKey) {
  if (packageKey.startsWith("@")) {
    const slash = packageKey.indexOf("/");
    return slash === -1 ? -1 : packageKey.indexOf("@", slash + 1);
  }
  return packageKey.indexOf("@");
}

function parseExactPackageKey(packageKey) {
  const separator = packageVersionSeparator(packageKey);
  const name = packageKey.slice(0, separator);
  const version = packageKey.slice(separator + 1);
  if (separator === -1 || !name || !EXACT_VERSION.test(version)) {
    throw new Error(`Unsupported registry package key ${packageKey}`);
  }
  return { name, version };
}

export function readMinimumReleaseAgeMinutes(npmrcSource) {
  for (const rawLine of npmrcSource.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== "min-release-age") continue;
    const days = Number(line.slice(separator + 1).trim());
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(
        "min-release-age must be a non-negative integer number of days",
      );
    }
    return days * 24 * 60;
  }
  throw new Error(".npmrc must define min-release-age in days");
}

export async function findReleaseAgeViolations({
  lockfile,
  minimumReleaseAgeMinutes,
  exceptions,
  now,
  getPackageTimes,
}) {
  if (Number(lockfile?.lockfileVersion) !== 3) {
    throw new Error(
      "Release-age validation supports only npm lockfile version 3",
    );
  }
  if (
    !Number.isInteger(minimumReleaseAgeMinutes) ||
    minimumReleaseAgeMinutes < 0
  ) {
    throw new Error(
      "minimum-release-age must be a non-negative integer number of minutes",
    );
  }
  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("package-lock.json must contain a packages object");
  }
  if (
    !exceptions?.minimumReleaseAge ||
    typeof exceptions.minimumReleaseAge !== "object" ||
    Array.isArray(exceptions.minimumReleaseAge)
  ) {
    throw new Error(
      "dependency policy exceptions must contain a minimumReleaseAge object",
    );
  }

  const checkedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new Error("Release-age validation time is invalid");
  }

  const violations = [];
  const packagesByName = new Map();
  const resolvedPackageKeys = new Set();
  for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
    if (
      !packageEntry ||
      packageEntry.link === true ||
      typeof packageEntry.version !== "string" ||
      typeof packageEntry.resolved !== "string"
    ) {
      continue;
    }
    const name = packageEntry.name ?? packageNameFromLockPath(packagePath);
    if (!name || !EXACT_VERSION.test(packageEntry.version)) {
      throw new Error(`Unsupported registry package at ${packagePath}`);
    }
    const resolvedName = registryPackageNameFromResolved(packageEntry.resolved);
    if (resolvedName && resolvedName !== name) {
      violations.push(
        `${packagePath}: package ${name} resolves to registry package ${resolvedName}`,
      );
    }
    const packageKey = `${name}@${packageEntry.version}`;
    resolvedPackageKeys.add(packageKey);
    const versions = packagesByName.get(name) ?? new Set();
    versions.add(packageEntry.version);
    packagesByName.set(name, versions);
  }

  const exceptionMetadata = exceptions.minimumReleaseAge;
  const exceptionKeys = new Set();
  for (const packageKey of Object.keys(exceptionMetadata)) {
    try {
      parseExactPackageKey(packageKey);
    } catch {
      violations.push(
        `${packageKey}: release-age exception must use an exact package@version`,
      );
      continue;
    }
    exceptionKeys.add(packageKey);
    if (!resolvedPackageKeys.has(packageKey)) {
      violations.push(
        `${packageKey}: release-age exception does not resolve in package-lock.json`,
      );
    }
  }

  const thresholdMs = minimumReleaseAgeMinutes * 60_000;
  const packageViolations = await mapWithConcurrency(
    [...packagesByName],
    REGISTRY_CONCURRENCY,
    async ([name, versions]) => {
      let publishedByVersion = await getPackageTimes(name);
      const cachedMetadataIsMissingVersion = [...versions].some(
        (version) =>
          !Number.isFinite(new Date(publishedByVersion?.[version]).getTime()),
      );
      if (cachedMetadataIsMissingVersion) {
        publishedByVersion = await getPackageTimes(name, { refresh: true });
      }

      const results = [];
      for (const version of versions) {
        const packageKey = `${name}@${version}`;
        const publishedAt = new Date(publishedByVersion?.[version]);
        if (!Number.isFinite(publishedAt.getTime())) {
          results.push(
            `${packageKey}: registry publication time is missing or invalid`,
          );
          continue;
        }
        const eligibleAt = new Date(publishedAt.getTime() + thresholdMs);
        const exception = exceptionMetadata[packageKey];
        if (checkedAt < eligibleAt) {
          if (!exception) {
            results.push(
              `${packageKey}: published ${publishedAt.toISOString()}, eligible ${eligibleAt.toISOString()}`,
            );
            continue;
          }
          const expiresAt = new Date(exception.expiresAt);
          if (
            typeof exception.reason !== "string" ||
            exception.reason.trim().length < 20
          ) {
            results.push(
              `${packageKey}: release-age exception requires a meaningful reason`,
            );
          } else if (!Number.isFinite(expiresAt.getTime())) {
            results.push(
              `${packageKey}: release-age exception expiry is missing or invalid`,
            );
          } else if (expiresAt > eligibleAt) {
            results.push(
              `${packageKey}: release-age exception expires after normal eligibility ${eligibleAt.toISOString()}`,
            );
          } else if (checkedAt >= expiresAt) {
            results.push(
              `${packageKey}: release-age exception expired ${expiresAt.toISOString()}`,
            );
          }
        } else if (exceptionKeys.has(packageKey)) {
          results.push(
            `${packageKey}: release-age exception is stale and must be removed`,
          );
        }
      }
      return results;
    },
  );

  violations.push(...packageViolations.flat());
  return violations;
}

export async function validateRepository(
  rootDirectory,
  { now = new Date(), getPackageTimes = createPackagePublicationLookup() } = {},
) {
  const exceptions = JSON.parse(
    await readFile(
      path.join(rootDirectory, "dependency-policy-exceptions.json"),
      "utf8",
    ),
  );
  const [lockfileSource, npmrcSource] = await Promise.all([
    readFile(path.join(rootDirectory, "package-lock.json"), "utf8"),
    readFile(path.join(rootDirectory, ".npmrc"), "utf8"),
  ]);
  const violations = await findReleaseAgeViolations({
    lockfile: JSON.parse(lockfileSource),
    minimumReleaseAgeMinutes: readMinimumReleaseAgeMinutes(npmrcSource),
    exceptions,
    now,
    getPackageTimes,
  });
  return violations.map((violation) => `package-lock.json: ${violation}`);
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const rootDirectory = path.resolve(import.meta.dirname, "..");
  try {
    const violations = await validateRepository(rootDirectory);
    if (violations.length > 0) {
      for (const violation of violations) console.error(violation);
      process.exitCode = 1;
    } else {
      console.log("Lockfile release-age policy passed.");
    }
  } catch (error) {
    console.error(`Lockfile release-age validation failed: ${error}`);
    process.exitCode = 1;
  }
}
