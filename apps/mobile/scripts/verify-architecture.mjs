import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cases = [
  ["src/features/shell/capabilities/proof.ts", "export const proof = true;\n", true],
  ["src/features/shell/components/proof.ts", "export const proof = true;\n", true],
  ["src/features/shell/routes/proof.ts", 'import "../components/proof";\n', true],
  ["src/features/shell/routes/proof-forbidden.ts", 'import "../adapters/proof";\n', false],
  ["src/features/shell/domain/proof.ts", 'import "../capabilities/proof";\n', true],
  ["src/features/shell/domain/proof-forbidden.ts", 'import "../adapters/proof";\n', false],
  ["src/features/shell/adapters/proof.ts", "export const proof = true;\n", true],
  ["src/features/native-contracts/adapters/proof.ts", 'import "../../../../modules/streamfusion-native-contracts/src/contracts";\n', true],
  ["src/features/native-contracts/domain/proof-native.ts", 'import "../../../../modules/streamfusion-native-contracts/src/contracts";\n', false],
  ["src/features/native-contracts/components/proof-tests.ts", 'import "../tests/android-capability-contracts.test";\n', false],
  ["src/features/native-contracts/components/proof-native-sdk.ts", 'import { requireNativeModule } from "expo-modules-core";\nexport const bypass = requireNativeModule("StreamFusionMaintenance");\n', false, "no-restricted-imports"],
  ["src/features/native-contracts/domain/proof-native-sdk.ts", 'import { requireNativeModule } from "expo-modules-core";\nexport const bypass = requireNativeModule("StreamFusionMaintenance");\n', false, "no-restricted-imports"],
  ["src/features/native-contracts/components/proof-expo-sdk.ts", 'import { requireNativeModule } from "expo";\nexport const bypass = requireNativeModule("StreamFusionMaintenance");\n', false, "no-restricted-imports"],
  ["src/features/native-contracts/components/proof-react-native-sdk.ts", 'import { NativeModules, TurboModuleRegistry } from "react-native";\nexport const bypass = [NativeModules.StreamFusionMaintenance, TurboModuleRegistry.get("StreamFusionMaintenance")];\n', false, "no-restricted-imports"],
  ["src/features/native-contracts/components/proof-react-native-namespace.ts", 'import * as ReactNative from "react-native";\nexport const bypass = ReactNative.NativeModules.StreamFusionMaintenance;\n', false, "no-restricted-syntax"],
  ["src/features/native-contracts/adapters/proof-native-sdk.ts", 'import { requireNativeModule } from "expo-modules-core";\nexport const adapter = requireNativeModule("StreamFusionMaintenance");\n', true],
  ["modules/streamfusion-native-contracts/src/proof-alias.ts", 'import "@mobile/features/native-contracts/capabilities/android-capability-contracts";\n', false],
  ["modules/streamfusion-native-contracts/src/proof-dynamic.ts", 'void import("@mobile/features/native-contracts/capabilities/android-capability-contracts");\n', false],
  ["modules/streamfusion-native-contracts/src/proof-require.ts", 'require("@mobile/features/native-contracts/capabilities/android-capability-contracts");\n', false],
];
const files = cases.map(([file]) => path.join(root, file));
try {
  for (const [file, source] of cases) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source); }
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") });
  for (const [file, , allowed, forbiddenRule = "boundaries/dependencies"] of cases) { const [result] = await eslint.lintFiles([path.join(root, file)]); assert.equal(result.messages.some((message) => message.ruleId === forbiddenRule), !allowed, `${file}: incorrect dependency decision`); }
  console.log("Feature architecture import proof passed.");
} finally { await Promise.all(files.map((file) => rm(file, { force: true }))); }
