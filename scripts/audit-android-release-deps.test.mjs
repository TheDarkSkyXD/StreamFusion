import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { partitionAdvisories } from "./audit-android-release-deps.mjs";

const SHIPPED = new Set(["expo-sqlite", "expo-secure-store", "react-native"]);

function vulnerability(overrides) {
  return {
    severity: "high",
    isDirect: false,
    effects: [],
    via: [{ title: "an advisory" }],
    ...overrides,
  };
}

test("a vulnerability in a shipped production dependency blocks the release", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-sqlite": vulnerability({ isDirect: true }),
      },
    },
    shipped: SHIPPED,
  });

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].package, "expo-sqlite");
  assert.equal(blocking[0].direct, true);
  assert.deepEqual(ignored, []);
});

test("a vulnerability only reachable through a shipped dependency blocks the release", () => {
  const { blocking } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "some-transitive": vulnerability({ effects: ["expo-sqlite"] }),
      },
    },
    shipped: SHIPPED,
  });

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].direct, false);
});

test("build-time-only tooling is reported as ignored rather than silently dropped", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "brace-expansion": vulnerability({ effects: ["@expo/fingerprint"] }),
        jsdom: vulnerability({ isDirect: true }),
      },
    },
    shipped: SHIPPED,
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(
    ignored.map((entry) => entry.package).sort(),
    ["brace-expansion", "jsdom"],
  );
});

test("moderate and low advisories never block a release", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-sqlite": vulnerability({ severity: "moderate", isDirect: true }),
        "react-native": vulnerability({ severity: "low", isDirect: true }),
      },
    },
    shipped: SHIPPED,
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(ignored, []);
});

test("critical advisories block the release", () => {
  const { blocking } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-secure-store": vulnerability({ severity: "critical", isDirect: true }),
      },
    },
    shipped: SHIPPED,
  });

  assert.equal(blocking.length, 1);
});

test("an audit with no findings passes", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: { vulnerabilities: {} },
    shipped: SHIPPED,
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(ignored, []);
});

test("the release workflow runs the shipped-tree audit and not the repository one", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");

  assert.match(
    source,
    /name: Audit the shipped Android dependency tree/u,
    "the Android release must audit the tree it ships",
  );
  assert.match(source, /scripts\/audit-android-release-deps\.mjs/u);
  assert.doesNotMatch(
    source,
    /npm run audit:dependencies/u,
    "an Android release must not be blocked by the Electron and worker trees",
  );
});

test("every mobile production dependency is treated as shipped", () => {
  const manifest = JSON.parse(readFileSync("apps/mobile/package.json", "utf8"));
  const shipped = new Set(Object.keys(manifest.dependencies ?? {}));

  assert.ok(shipped.size > 20, "the mobile app has a real production dependency set");
  for (const name of ["expo-sqlite", "expo-secure-store", "react-native"]) {
    assert.ok(shipped.has(name), `${name} must count as shipped`);
  }
  assert.equal(
    shipped.has("jsdom"),
    false,
    "jsdom is a test-only dependency and is not part of the APK",
  );
});
