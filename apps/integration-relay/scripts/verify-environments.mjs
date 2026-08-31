import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")
);
const environmentNames = Object.keys(config.env ?? {}).sort();

assert.deepEqual(environmentNames, ["development", "production"]);
assert.equal(config.main, "src/composition/worker.ts");
assert.equal(config.compatibility_date, "2026-08-27");
assert.equal(config.name, config.env.development.name);
assert.equal(config.vars?.RELAY_ENVIRONMENT, "development");
assert.equal(
  config.env.development.name,
  "streamfusion-integration-relay-development"
);
assert.equal(
  config.env.production.name,
  "streamfusion-integration-relay-production"
);
assert.notEqual(config.env.development.name, config.env.production.name);
assert.equal(config.env.development.vars?.RELAY_ENVIRONMENT, "development");
assert.equal(config.env.production.vars?.RELAY_ENVIRONMENT, "production");

const resourceFields = [
  "d1_databases",
  "durable_objects",
  "kv_namespaces",
  "queues",
  "r2_buckets"
];
for (const environment of environmentNames) {
  for (const field of resourceFields) {
    assert.equal(
      config.env[environment][field],
      undefined,
      `${environment} must not declare ${field} before its product ticket`
    );
  }
}

const sensitiveName = /(secret|token|password|private[_-]?key|credential)/i;
for (const environment of environmentNames) {
  const variableNames = Object.keys(config.env[environment].vars ?? {});
  assert.equal(
    variableNames.some((name) => sensitiveName.test(name)),
    false,
    `${environment} contains a secret-like plaintext variable`
  );
}

console.log(
  `Environment isolation passed for ${config.env.development.name} and ${config.env.production.name}.`
);
