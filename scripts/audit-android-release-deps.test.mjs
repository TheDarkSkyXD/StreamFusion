import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bundledInstallNodes,
  partitionAdvisories,
} from "./audit-android-release-deps.mjs";

const SHIPPED = new Set(["expo-sqlite", "expo-secure-store", "react-native"]);

function vulnerability(name, overrides) {
  return {
    severity: "high",
    isDirect: false,
    effects: [],
    nodes: [`node_modules/${name}`],
    via: [{ name, title: "an advisory", severity: "high" }],
    ...overrides,
  };
}

test("a vulnerability in a shipped production dependency blocks the release", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-sqlite": vulnerability("expo-sqlite", { isDirect: true }),
      },
    },
    shipped: SHIPPED,
    bundled: new Set(),
  });

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].package, "expo-sqlite");
  assert.equal(blocking[0].direct, true);
  assert.deepEqual(ignored, []);
});

test("a bundled transitive vulnerability blocks even without a direct effects edge", () => {
  const { blocking } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "some-transitive": vulnerability("some-transitive", {
          effects: ["another-transitive"],
        }),
      },
    },
    shipped: SHIPPED,
    bundled: bundledInstallNodes({
      version: 3,
      sources: ["/node_modules/some-transitive/index.js"],
    }),
  });

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].direct, false);
});

test("build-time-only tooling is reported as ignored rather than silently dropped", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "brace-expansion": vulnerability("brace-expansion", {
          effects: ["@expo/fingerprint"],
        }),
        jsdom: vulnerability("jsdom", { isDirect: true }),
      },
    },
    shipped: SHIPPED,
    bundled: new Set(),
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(ignored.map((entry) => entry.package).sort(), [
    "brace-expansion",
    "jsdom",
  ]);
});

test("moderate and low advisories never block a release", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-sqlite": vulnerability("expo-sqlite", {
          severity: "moderate",
          isDirect: true,
          via: [
            {
              name: "expo-sqlite",
              title: "moderate advisory",
              severity: "moderate",
            },
          ],
        }),
        "react-native": vulnerability("react-native", {
          severity: "low",
          isDirect: true,
          via: [
            { name: "react-native", title: "low advisory", severity: "low" },
          ],
        }),
      },
    },
    shipped: SHIPPED,
    bundled: new Set(),
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(ignored, []);
});

test("critical advisories block the release", () => {
  const { blocking } = partitionAdvisories({
    report: {
      vulnerabilities: {
        "expo-secure-store": vulnerability("expo-secure-store", {
          severity: "critical",
          isDirect: true,
          via: [
            {
              name: "expo-secure-store",
              title: "critical advisory",
              severity: "critical",
            },
          ],
        }),
      },
    },
    shipped: SHIPPED,
    bundled: new Set(),
  });

  assert.equal(blocking.length, 1);
});

test("an audit with no findings passes", () => {
  const { blocking, ignored } = partitionAdvisories({
    report: { vulnerabilities: {} },
    shipped: SHIPPED,
    bundled: new Set(),
  });

  assert.deepEqual(blocking, []);
  assert.deepEqual(ignored, []);
});

test("propagated tooling metavulnerabilities do not become native findings", () => {
  const result = partitionAdvisories({
    report: {
      vulnerabilities: {
        braces: vulnerability("braces", { effects: ["expo", "react-native"] }),
        expo: vulnerability("expo", { isDirect: true, via: ["braces"] }),
        "react-native": vulnerability("react-native", {
          isDirect: true,
          via: ["braces"],
        }),
      },
    },
    shipped: new Set(["expo", "react-native"]),
    bundled: bundledInstallNodes({
      version: 3,
      sources: ["/node_modules/expo/index.js"],
    }),
  });
  assert.deepEqual(result, {
    blocking: [],
    ignored: [
      {
        package: "braces",
        severity: "high",
        direct: false,
        advisories: ["an advisory"],
      },
    ],
  });
});

test("only the affected bundled install is blocked when package versions are nested", () => {
  const input = {
    report: { vulnerabilities: { vulnerable: vulnerability("vulnerable") } },
    shipped: SHIPPED,
    bundled: bundledInstallNodes({
      version: 3,
      sources: ["/node_modules/parent/node_modules/vulnerable/index.js"],
    }),
  };
  assert.deepEqual(
    partitionAdvisories(input).ignored.map((entry) => entry.package),
    ["vulnerable"],
  );
  input.report.vulnerabilities.vulnerable.nodes = [
    "node_modules/parent/node_modules/vulnerable",
  ];
  assert.deepEqual(
    partitionAdvisories(input).blocking.map((entry) => entry.package),
    ["vulnerable"],
  );
});

test("source maps preserve scoped, nested and Windows install paths", () => {
  assert.deepEqual(
    [
      ...bundledInstallNodes({
        version: 3,
        sources: [
          "/node_modules/@expo/metro-runtime/index.js",
          "/node_modules/parent/node_modules/braces/index.js",
          "\\apps\\mobile\\node_modules\\@vendor\\native\\index.js",
          "/apps/mobile/src/index.ts",
        ],
      }),
    ].sort(),
    [
      "apps/mobile/node_modules/@vendor/native",
      "node_modules/@expo/metro-runtime",
      "node_modules/parent/node_modules/braces",
    ],
  );
});

test("missing or malformed audit and bundle evidence fails closed", () => {
  for (const sourceMap of [
    {},
    { version: 3, sources: [] },
    { version: 3, sources: [null] },
    { version: 3, sources: ["/app.js"] },
  ]) {
    assert.throws(() => bundledInstallNodes(sourceMap));
  }
  assert.throws(() =>
    partitionAdvisories({
      report: { error: "audit unavailable" },
      shipped: SHIPPED,
      bundled: new Set(),
    }),
  );
  assert.throws(() =>
    partitionAdvisories({
      report: {
        vulnerabilities: { braces: vulnerability("braces", { nodes: [] }) },
      },
      shipped: SHIPPED,
      bundled: new Set(),
    }),
  );
  assert.deepEqual(
    partitionAdvisories({
      report: {
        vulnerabilities: { "expo-sqlite": vulnerability("expo-sqlite") },
      },
      shipped: SHIPPED,
      bundled: new Set(),
    }).blocking.map((entry) => entry.package),
    ["expo-sqlite"],
  );
});

test("audit errors and incomplete concrete advisories cannot produce a passing verdict", () => {
  for (const report of [
    { error: { code: "EAUDIT" }, vulnerabilities: {} },
    {
      vulnerabilities: {
        braces: vulnerability("braces", {
          via: [{ name: "braces", title: "advisory" }],
        }),
      },
    },
    { vulnerabilities: { braces: vulnerability("braces", { via: [] }) } },
    {
      vulnerabilities: {
        braces: vulnerability("braces", { via: ["missing-package"] }),
      },
    },
  ]) {
    assert.throws(() =>
      partitionAdvisories({
        report,
        shipped: SHIPPED,
        bundled: new Set(["node_modules/braces"]),
      }),
    );
  }
  const report = { vulnerabilities: { braces: vulnerability("braces") } };
  assert.deepEqual(
    partitionAdvisories({
      report,
      shipped: SHIPPED,
      bundled: new Set(["node_modules/braces"]),
    }).blocking.map((entry) => entry.package),
    ["braces"],
  );
});

test("source roots and paths outside the repository fail instead of misclassifying installs", () => {
  assert.throws(() =>
    bundledInstallNodes({
      version: 3,
      sourceRoot: "/apps/mobile/",
      sources: ["node_modules/vulnerable/index.js"],
    }),
  );
  assert.throws(() =>
    bundledInstallNodes({
      version: 3,
      sources: ["/../node_modules/vulnerable/index.js"],
    }),
  );
  assert.deepEqual(
    [
      ...bundledInstallNodes({
        version: 3,
        sources: ["/apps/mobile/node_modules/vulnerable/index.js"],
      }),
    ],
    ["apps/mobile/node_modules/vulnerable"],
  );
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

  assert.ok(
    shipped.size > 20,
    "the mobile app has a real production dependency set",
  );
  for (const name of ["expo-sqlite", "expo-secure-store", "react-native"]) {
    assert.ok(shipped.has(name), `${name} must count as shipped`);
  }
  assert.equal(
    shipped.has("jsdom"),
    false,
    "jsdom is a test-only dependency and is not part of the APK",
  );
});
