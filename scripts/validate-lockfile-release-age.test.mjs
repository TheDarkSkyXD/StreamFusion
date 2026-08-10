import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findReleaseAgeViolations,
  createPackagePublicationLookup,
  validateRepository,
} from "./validate-lockfile-release-age.mjs";

const now = new Date("2026-08-05T12:00:00.000Z");

function policyInput(overrides = {}) {
  return {
    lockfile: {
      lockfileVersion: "9.0",
      packages: {
        "stable-package@1.2.3": {
          resolution: { integrity: "sha512-test" },
        },
      },
    },
    workspace: {
      minimumReleaseAge: 10080,
      minimumReleaseAgeExclude: [],
    },
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
      lockfileVersion: "9.0",
      packages: {
        "fast-uri@3.1.5": { resolution: { integrity: "sha512-test" } },
      },
    },
    workspace: {
      minimumReleaseAge: 10080,
      minimumReleaseAgeExclude: ["fast-uri@3.1.5"],
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

// Guards: every registry package resolved in pnpm-lock.yaml must satisfy the configured release-age threshold.
test("accepts a resolved package older than the minimum release age", async () => {
  assert.deepEqual(await findReleaseAgeViolations(policyInput()), []);
});

test("accepts a young package only through a matching exact temporary exception", async () => {
  assert.deepEqual(await findReleaseAgeViolations(youngPackageInput()), []);
});

test("rejects a young package without an exception", async () => {
  const violations = await findReleaseAgeViolations(
    youngPackageInput({
      workspace: {
        minimumReleaseAge: 10080,
        minimumReleaseAgeExclude: [],
      },
      exceptions: { minimumReleaseAge: {} },
    }),
  );

  assert.match(
    violations.join("\n"),
    /fast-uri@3\.1\.5: published .* eligible/,
  );
});

test("rejects an exclusion without matching exception metadata", async () => {
  const violations = await findReleaseAgeViolations(
    youngPackageInput({ exceptions: { minimumReleaseAge: {} } }),
  );

  assert.match(violations.join("\n"), /missing reason and expiry metadata/);
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

test("rejects an exception expiring after normal eligibility", async () => {
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

test("rejects an expired release-age exception", async () => {
  const violations = await findReleaseAgeViolations(
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

  assert.match(violations.join("\n"), /release-age exception expired/);
});

test("rejects a stale exception after the package becomes normally eligible", async () => {
  const violations = await findReleaseAgeViolations(
    policyInput({
      workspace: {
        minimumReleaseAge: 10080,
        minimumReleaseAgeExclude: ["stable-package@1.2.3"],
      },
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

  assert.match(violations.join("\n"), /exception is stale and must be removed/);
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

test("refreshes online once when cached metadata omits a locked version", async () => {
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
  assert.equal(requests[0].registry, "https://registry.npmjs.org");
  assert.equal(requests[0].preferOffline, true);
  assert.equal(requests[1].registry, "https://registry.npmjs.org");
  assert.equal(requests[1].preferOnline, true);
});

test("reports a missing or invalid timestamp after one online retry", async () => {
  for (const timestamp of [undefined, "not-a-date"]) {
    let requestCount = 0;
    const violations = await findReleaseAgeViolations(
      policyInput({
        getPackageTimes: async () => {
          requestCount += 1;
          return { "1.2.3": timestamp };
        },
      }),
    );

    assert.equal(requestCount, 2);
    assert.match(
      violations.join("\n"),
      /publication time is missing or invalid/,
    );
  }
});

test("propagates an online metadata lookup failure", async () => {
  const getPackageTimes = createPackagePublicationLookup({
    packument: async (_name, options) => {
      if (options.preferOnline) throw new Error("online registry unavailable");
      return { time: { "1.2.2": "2026-07-01T00:00:00.000Z" } };
    },
  });

  await assert.rejects(
    findReleaseAgeViolations(policyInput({ getPackageTimes })),
    /online registry unavailable/,
  );
});

test("rejects an invalid validation time", async () => {
  await assert.rejects(
    findReleaseAgeViolations(policyInput({ now: "not-a-date" })),
    /validation time.*invalid/i,
  );
});

test("rejects missing or malformed minimumReleaseAge exception policy", async () => {
  for (const exceptions of [
    {},
    { minimumReleaseAge: null },
    { minimumReleaseAge: [] },
    { minimumReleaseAge: "invalid" },
  ]) {
    await assert.rejects(
      findReleaseAgeViolations(policyInput({ exceptions })),
      /must contain a minimumReleaseAge object/,
    );
  }
});

test("parses scoped packages and pnpm peer suffixes without duplicate checks", async () => {
  const requestedNames = [];
  const violations = await findReleaseAgeViolations(
    policyInput({
      lockfile: {
        lockfileVersion: "9.0",
        packages: {
          "@scope/stable-package@1.2.3(peer-package@2.0.0)": {
            resolution: { integrity: "sha512-test" },
          },
          "@scope/stable-package@1.2.3(peer-package@3.0.0)": {
            resolution: { integrity: "sha512-test" },
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

test("rejects non-exact pnpm release-age exclusions", async () => {
  const violations = await findReleaseAgeViolations(
    policyInput({
      workspace: {
        minimumReleaseAge: 10080,
        minimumReleaseAgeExclude: ["stable-package@^1.2.0"],
      },
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

test("validates the repository lockfile and policy files together", async () => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "streamfusion-release-age-"),
  );
  try {
    await Promise.all([
      writeFile(
        path.join(rootDirectory, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\npackages:\n  stable-package@1.2.3:\n    resolution: {integrity: sha512-test}\n",
      ),
      writeFile(
        path.join(rootDirectory, "pnpm-workspace.yaml"),
        "minimumReleaseAge: 10080\nminimumReleaseAgeExclude: []\n",
      ),
      writeFile(
        path.join(rootDirectory, "dependency-policy-exceptions.json"),
        '{"minimumReleaseAge":{}}\n',
      ),
    ]);

    const violations = await validateRepository(rootDirectory, {
      now,
      getPackageTimes: async () => ({
        "1.2.3": "2026-07-01T00:00:00.000Z",
      }),
    });

    assert.deepEqual(violations, []);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
