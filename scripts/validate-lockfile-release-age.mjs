import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { load as loadYaml } from "js-yaml";
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

function packageVersionSeparator(packageKey) {
  if (packageKey.startsWith("@")) {
    const slash = packageKey.indexOf("/");
    return slash === -1 ? -1 : packageKey.indexOf("@", slash + 1);
  }
  return packageKey.indexOf("@");
}

function parsePackageKey(packageKey, { allowPeerSuffix = false } = {}) {
  const separator = packageVersionSeparator(packageKey);
  const name = packageKey.slice(0, separator);
  const versionAndPeers = packageKey.slice(separator + 1);
  const peerSuffix = versionAndPeers.indexOf("(");
  const version =
    peerSuffix === -1 ? versionAndPeers : versionAndPeers.slice(0, peerSuffix);

  if (
    separator === -1 ||
    !name ||
    !EXACT_VERSION.test(version) ||
    (!allowPeerSuffix && peerSuffix !== -1) ||
    (peerSuffix !== -1 && !versionAndPeers.endsWith(")"))
  ) {
    throw new Error(`Unsupported registry package key ${packageKey}`);
  }
  return { name, version };
}

export async function findReleaseAgeViolations({
  lockfile,
  workspace,
  exceptions,
  now,
  getPackageTimes,
}) {
  if (String(lockfile?.lockfileVersion) !== "9.0") {
    throw new Error(
      "Release-age validation supports only pnpm lockfile version 9.0",
    );
  }
  if (
    !Number.isInteger(workspace?.minimumReleaseAge) ||
    workspace.minimumReleaseAge < 0
  ) {
    throw new Error(
      "minimumReleaseAge must be a non-negative integer number of minutes",
    );
  }
  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("pnpm-lock.yaml must contain a packages map");
  }

  const thresholdMs = workspace.minimumReleaseAge * 60_000;
  const checkedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new Error("release-age validation time is invalid");
  }
  const packagesByName = new Map();
  const resolvedPackageKeys = new Set();

  for (const packageKey of Object.keys(lockfile.packages)) {
    const resolvedPackage = parsePackageKey(packageKey, {
      allowPeerSuffix: true,
    });
    const canonicalPackageKey = `${resolvedPackage.name}@${resolvedPackage.version}`;
    resolvedPackageKeys.add(canonicalPackageKey);
    const versions = packagesByName.get(resolvedPackage.name) ?? new Set();
    versions.add(resolvedPackage.version);
    packagesByName.set(resolvedPackage.name, versions);
  }

  const violations = [];
  const excludedPackages = workspace.minimumReleaseAgeExclude ?? [];
  const exceptionMetadata = exceptions?.minimumReleaseAge;
  if (!Array.isArray(excludedPackages)) {
    throw new Error(
      "minimumReleaseAgeExclude must be an array of exact package@version entries",
    );
  }
  if (
    !exceptionMetadata ||
    typeof exceptionMetadata !== "object" ||
    Array.isArray(exceptionMetadata)
  ) {
    throw new Error(
      "dependency policy exceptions must contain a minimumReleaseAge object",
    );
  }

  const excludedPackageSet = new Set();
  for (const packageKey of excludedPackages) {
    try {
      parsePackageKey(packageKey);
    } catch {
      violations.push(
        `${packageKey}: minimumReleaseAgeExclude must use an exact package@version`,
      );
      continue;
    }
    if (excludedPackageSet.has(packageKey)) {
      violations.push(
        `${packageKey}: duplicate minimumReleaseAgeExclude entry`,
      );
    }
    excludedPackageSet.add(packageKey);
    if (!resolvedPackageKeys.has(packageKey)) {
      violations.push(
        `${packageKey}: release-age exception does not resolve in pnpm-lock.yaml`,
      );
    }
    if (!Object.hasOwn(exceptionMetadata, packageKey)) {
      violations.push(
        `${packageKey}: release-age exception is missing reason and expiry metadata`,
      );
    }
  }

  for (const packageKey of Object.keys(exceptionMetadata)) {
    if (!excludedPackageSet.has(packageKey)) {
      violations.push(
        `${packageKey}: release-age exception metadata has no matching pnpm exclusion`,
      );
    }
  }

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
        const publishedAt = new Date(publishedByVersion?.[version]);
        if (!Number.isFinite(publishedAt.getTime())) {
          results.push(
            `${name}@${version}: registry publication time is missing or invalid`,
          );
          continue;
        }
        const eligibleAt = new Date(publishedAt.getTime() + thresholdMs);
        if (checkedAt < eligibleAt) {
          const packageKey = `${name}@${version}`;
          if (excludedPackageSet.has(packageKey)) {
            const exception = exceptionMetadata[packageKey];
            const expiresAt = new Date(exception?.expiresAt);
            if (
              typeof exception?.reason !== "string" ||
              exception.reason.trim().length < 20
            ) {
              results.push(
                `${packageKey}: release-age exception requires a meaningful reason`,
              );
              continue;
            }
            if (!Number.isFinite(expiresAt.getTime())) {
              results.push(
                `${packageKey}: release-age exception expiry is missing or invalid`,
              );
              continue;
            }
            if (expiresAt > eligibleAt) {
              results.push(
                `${packageKey}: release-age exception expires after normal eligibility ${eligibleAt.toISOString()}`,
              );
              continue;
            }
            if (checkedAt >= expiresAt) {
              results.push(
                `${packageKey}: release-age exception expired ${expiresAt.toISOString()}`,
              );
              continue;
            }
            continue;
          }
          results.push(
            `${name}@${version}: published ${publishedAt.toISOString()}, eligible ${eligibleAt.toISOString()}`,
          );
        } else if (excludedPackageSet.has(`${name}@${version}`)) {
          results.push(
            `${name}@${version}: release-age exception is stale and must be removed`,
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
  const [lockfileSource, workspaceSource, exceptionSource] = await Promise.all([
    readFile(path.join(rootDirectory, "pnpm-lock.yaml"), "utf8"),
    readFile(path.join(rootDirectory, "pnpm-workspace.yaml"), "utf8"),
    readFile(
      path.join(rootDirectory, "dependency-policy-exceptions.json"),
      "utf8",
    ),
  ]);

  return findReleaseAgeViolations({
    lockfile: loadYaml(lockfileSource),
    workspace: loadYaml(workspaceSource),
    exceptions: JSON.parse(exceptionSource),
    now,
    getPackageTimes,
  });
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
