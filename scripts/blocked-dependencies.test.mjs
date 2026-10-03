import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedDependency,
  findBlockedRuntimeDependencies,
} from "./blocked-dependencies.mjs";
import { findForbiddenDependencySources } from "./validate-dependency-sources.mjs";

test("blocked dependencies and aliases cannot be declared in any manifest section", () => {
  const violations = findForbiddenDependencySources({
    dependencies: { "node-forge": "1.4.0", safe: "1.0.0" },
    devDependencies: { braces: "3.0.3" },
    optionalDependencies: { cache: "npm:http-cache-semantics@4.2.0" },
    peerDependencies: { forge: "npm:node-forge@1.4.0" },
  });
  assert.deepEqual(
    violations.map(({ dependency, section }) => ({ dependency, section })),
    [
      { dependency: "node-forge", section: "dependencies" },
      { dependency: "braces", section: "devDependencies" },
      { dependency: "cache", section: "optionalDependencies" },
      { dependency: "forge", section: "peerDependencies" },
    ],
  );
  assert.match(violations[0].reason, /GHSA-86w9-cpqp-85rv/u);
  assert.equal(blockedDependency("safe", "npm:@npmcli/fs@3.1.0"), undefined);
});

test("blocked runtime packages are rejected even without an npm advisory", () => {
  assert.deepEqual(
    findBlockedRuntimeDependencies({
      direct: new Set(["node-forge", "expo-sqlite"]),
      bundled: new Set([
        "node_modules/parent/node_modules/braces",
        "apps/mobile/node_modules/http-cache-semantics",
        "node_modules/expo",
      ]),
    }),
    ["braces", "node-forge", "http-cache-semantics"],
  );
  assert.deepEqual(
    findBlockedRuntimeDependencies({
      direct: new Set(["expo-sqlite"]),
      bundled: new Set([
        "node_modules/@expo/metro-runtime",
        "node_modules/react-native",
      ]),
    }),
    [],
  );
});
