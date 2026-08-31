import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPackagePublicationLookup,
  findReleaseAgeViolations,
  readMinimumReleaseAgeMinutes,
  validateRepository,
} from "./validate-lockfile-release-age.mjs";

const now = new Date("2026-08-05T12:00:00.000Z");

function registryPackage(name, version) {
  return {
    [`node_modules/${name}`]: {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: "sha512-test",
    },
  };
}

function policyInput(overrides = {}) {
  return {
    lockfile: {
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture", version: "1.0.0" },
        ...registryPackage("stable-package", "1.2.3"),
      },
    },
    minimumReleaseAgeMinutes: 7 * 24 * 60,
    exceptions: { minimumReleaseAge: {} },
    now,
    getPackageTimes: async () => ({
      "1.2.3": "2026-07-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function youngPackageInput(overrides = {}) {
  return policyInput({
    lockfile: {
      lockfileVersion: 3,
      packages: registryPackage("fast-uri", "3.1.5"),
    },
    exceptions: {
      minimumReleaseAge: {
        "fast-uri@3.1.5": {
          reason: "Urgent fix for the production fast-uri security advisories.",
          expiresAt: "2026-08-07T09:16:56.212Z",
        },
      },
    },
    getPackageTimes: async () => ({
      "3.1.5": "2026-07-31T09:16:56.212Z",
    }),
    ...overrides,
  });
}

test("accepts a resolved package older than the minimum release age", async () => {
  assert.deepEqual(await findReleaseAgeViolations(policyInput()), []);
});

test("reads npm's release-age setting in days as minutes", () => {
  assert.equal(readMinimumReleaseAgeMinutes("min-release-age=7\n"), 10080);
  assert.throws(
    () => readMinimumReleaseAgeMinutes("min-release-age=soon\n"),
    /non-negative integer number of days/,
  );
  assert.throws(
    () => readMinimumReleaseAgeMinutes("audit=true\n"),
    /must define min-release-age/,
  );
});

test("accepts a young package only through an exact temporary exception", async () => {
  assert.deepEqual(await findReleaseAgeViolations(youngPackageInput()), []);
});

test("rejects a young package without an exception", async () => {
  const violations = await findReleaseAgeViolations(
    youngPackageInput({ exceptions: { minimumReleaseAge: {} } }),
  );
  assert.match(
    violations.join("\n"),
    /fast-uri@3\.1\.5: published .* eligible/,
  );
});

test("rejects an exception that does not resolve in the lockfile", async () => {
  const violations = await findReleaseAgeViolations(
    policyInput({
      exceptions: {
        minimumReleaseAge: {
          "missing-package@1.0.0": {
            reason: "This package is intentionally absent from the fixture.",
            expiresAt: "2026-08-06T00:00:00.000Z",
          },
        },
      },
    }),
  );
  assert.match(violations.join("\n"), /does not resolve in package-lock\.json/);
});

test("rejects non-exact exception keys", async () => {
  const violations = await findReleaseAgeViolations(
    policyInput({
      exceptions: {
        minimumReleaseAge: {
          "stable-package@^1.2.0": {
            reason: "A range must never bypass release-age validation.",
            expiresAt: "2026-08-06T00:00:00.000Z",
          },
        },
      },
    }),
  );
  assert.match(violations.join("\n"), /must use an exact package@version/);
});

test("rejects an exception with an empty or short reason", async () => {
  for (const reason of ["", "too short"]) {
    const violations = await findReleaseAgeViolations(
      youngPackageInput({
        exceptions: {
          minimumReleaseAge: {
            "fast-uri@3.1.5": {
              reason,
              expiresAt: "2026-08-07T09:16:56.212Z",
            },
          },
        },
      }),
    );
    assert.match(violations.join("\n"), /requires a meaningful reason/);
  }
});

test("rejects an exception that outlives normal eligibility", async () => {
  const violations = await findReleaseAgeViolations(
    youngPackageInput({
      exceptions: {
        minimumReleaseAge: {
          "fast-uri@3.1.5": {
            reason: "This reason is long enough for the policy validator.",
            expiresAt: "2026-08-07T09:16:56.213Z",
          },
        },
      },
    }),
  );
  assert.match(violations.join("\n"), /expires after normal eligibility/);
});

test("rejects expired and stale exceptions", async () => {
  const expired = await findReleaseAgeViolations(
    youngPackageInput({
      exceptions: {
        minimumReleaseAge: {
          "fast-uri@3.1.5": {
            reason: "This reason is long enough for the policy validator.",
            expiresAt: "2026-08-05T11:59:59.999Z",
          },
        },
      },
    }),
  );
  assert.match(expired.join("\n"), /release-age exception expired/);

  const stale = await findReleaseAgeViolations(
    policyInput({
      exceptions: {
        minimumReleaseAge: {
          "stable-package@1.2.3": {
            reason: "This exception must be removed once no longer necessary.",
            expiresAt: "2026-07-08T00:00:00.000Z",
          },
        },
      },
    }),
  );
  assert.match(stale.join("\n"), /exception is stale and must be removed/);
});

test("coalesces registry publication lookups by package name", async () => {
  let requestCount = 0;
  const getPackageTimes = createPackagePublicationLookup({
    packument: async (_name, options) => {
      requestCount += 1;
      assert.equal(options.registry, "https://registry.npmjs.org");
      assert.equal(options.fullMetadata, true);
      assert.equal(options.preferOffline, true);
      return { time: { "1.0.0": "2026-07-01T00:00:00.000Z" } };
    },
  });

  const [first, second] = await Promise.all([
    getPackageTimes("stable-package"),
    getPackageTimes("stable-package"),
  ]);
  assert.equal(requestCount, 1);
  assert.deepEqual(first, second);
});

test("refreshes registry metadata once when the cache omits a version", async () => {
  const requests = [];
  const getPackageTimes = createPackagePublicationLookup({
    packument: async (_name, options) => {
      requests.push(options);
      return options.preferOnline
        ? { time: { "1.2.3": "2026-07-01T00:00:00.000Z" } }
        : { time: { "1.2.2": "2026-06-01T00:00:00.000Z" } };
    },
  });

  assert.deepEqual(
    await findReleaseAgeViolations(policyInput({ getPackageTimes })),
    [],
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].preferOffline, true);
  assert.equal(requests[1].preferOnline, true);
});

test("reports missing timestamps after one online retry", async () => {
  let requestCount = 0;
  const violations = await findReleaseAgeViolations(
    policyInput({
      getPackageTimes: async () => {
        requestCount += 1;
        return { "1.2.3": undefined };
      },
    }),
  );
  assert.equal(requestCount, 2);
  assert.match(violations.join("\n"), /publication time is missing or invalid/);
});

test("rejects malformed policy inputs", async () => {
  await assert.rejects(
    findReleaseAgeViolations(policyInput({ lockfile: { lockfileVersion: 2 } })),
    /only npm lockfile version 3/,
  );
  await assert.rejects(
    findReleaseAgeViolations(policyInput({ now: "not-a-date" })),
    /validation time.*invalid/i,
  );
  for (const exceptions of [
    {},
    { minimumReleaseAge: null },
    { minimumReleaseAge: [] },
  ]) {
    await assert.rejects(
      findReleaseAgeViolations(policyInput({ exceptions })),
      /must contain a minimumReleaseAge object/,
    );
  }
});

test("deduplicates scoped packages installed at multiple paths", async () => {
  const requestedNames = [];
  const violations = await findReleaseAgeViolations(
    policyInput({
      lockfile: {
        lockfileVersion: 3,
        packages: {
          "node_modules/@scope/stable-package": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/@scope/stable-package/-/stable-package-1.2.3.tgz",
          },
          "node_modules/parent/node_modules/@scope/stable-package": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/@scope/stable-package/-/stable-package-1.2.3.tgz",
          },
        },
      },
      getPackageTimes: async (name) => {
        requestedNames.push(name);
        return { "1.2.3": "2026-07-01T00:00:00.000Z" };
      },
    }),
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(requestedNames, ["@scope/stable-package"]);
});

test("checks resolved registry names while permitting npm aliases", async () => {
  const alias = await findReleaseAgeViolations(
    policyInput({
      lockfile: {
        lockfileVersion: 3,
        packages: {
          "node_modules/alias-name": {
            name: "stable-package",
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/stable-package/-/stable-package-1.2.3.tgz",
          },
        },
      },
    }),
  );
  assert.deepEqual(alias, []);

  const poisoned = await findReleaseAgeViolations(
    policyInput({
      lockfile: {
        lockfileVersion: 3,
        packages: {
          "node_modules/stable-package": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/different-package/-/different-package-1.2.3.tgz",
          },
        },
      },
    }),
  );
  assert.match(
    poisoned.join("\n"),
    /resolves to registry package different-package/,
  );
});

test("validates the root npm policy", async () => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "streamfusion-release-age-"),
  );
  try {
    const lockfile = (name, version) =>
      `${JSON.stringify({ lockfileVersion: 3, packages: registryPackage(name, version) })}\n`;
    await Promise.all([
      writeFile(
        path.join(rootDirectory, "package-lock.json"),
        lockfile("young-package", "2.0.0"),
      ),
      writeFile(path.join(rootDirectory, ".npmrc"), "min-release-age=7\n"),
      writeFile(
        path.join(rootDirectory, "dependency-policy-exceptions.json"),
        '{"minimumReleaseAge":{}}\n',
      ),
    ]);

    const violations = await validateRepository(rootDirectory, {
      now,
      getPackageTimes: async () => ({
        "2.0.0": "2026-08-05T00:00:00.000Z",
      }),
    });
    assert.equal(violations.length, 1);
    assert.match(
      violations[0],
      /^package-lock\.json: young-package@2\.0\.0:/,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
