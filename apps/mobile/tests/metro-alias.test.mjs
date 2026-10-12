import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const config = require("../metro.config.js");
const mobileRoot = fileURLToPath(new URL("../", import.meta.url));

test("the native bundle resolves mobile aliases to production files", () => {
  const result = config.resolver.resolveRequest({
    resolveRequest() { throw new Error("The mobile alias fell through to package resolution"); },
  }, "@mobile/composition/mobile-runtime", "android");
  assert.equal(result.type, "sourceFile");
  assert.equal(result.filePath, path.join(mobileRoot, "src/composition/mobile-runtime.tsx"));
});

test("Metro ignores native build output while keeping native source available", () => {
  const rules = [config.resolver.blockList].flat();
  assert.equal(new Set(rules.map((rule) => rule.flags)).size, 1, "Metro combines exclusions with matching flags");
  const excluded = (file) => rules.some((rule) => rule.test(path.join(mobileRoot, file)));
  for (const file of ["android/app/build/generated/source.js", "android/.gradle/state.bin", "android/app/.cxx/Debug/output.o", "modules/streamfusion-native-contracts/android/build/generated/source.js"]) {
    assert.equal(excluded(file), true, `${file} must not enter the JavaScript file map`);
  }
  assert.equal(excluded("modules/streamfusion-native-contracts/src/platform.ts"), false);
  assert.equal(excluded("src/composition/mobile-runtime.tsx"), false);
});
