import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: process.cwd() });

const [allowed] = await eslint.lintText(
  'import { View } from "react-native";\nvoid View;\n',
  {
    filePath: "app/architecture-proof-allowed.ts",
  },
);
const [forbidden] = await eslint.lintText(
  'import fs from "node:fs";\nvoid fs;\n',
  {
    filePath: "app/architecture-proof-forbidden.ts",
  },
);

assert.equal(allowed?.errorCount, 0);
assert.equal(forbidden?.errorCount, 1);
assert.equal(forbidden?.messages[0]?.ruleId, "no-restricted-imports");

console.log("Mobile route import proof passed.");
