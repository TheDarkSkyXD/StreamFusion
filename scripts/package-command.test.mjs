import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { packageDirectories, runPackageCommands } from "./package-command.mjs";

test("package commands run in their owning folders and preserve arguments", (t) => {
  const scratch = path.resolve(import.meta.dirname, "../packages/tooling/.tmp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, "package commands "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "apps", "example");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "example",
      scripts: { record: "node record.cjs", fail: 'node -e "process.exit(7)"' },
    }),
  );
  writeFileSync(
    path.join(directory, "record.cjs"),
    'require("node:fs").writeFileSync("result.json", JSON.stringify({cwd:process.cwd(), args:process.argv.slice(2)}));',
  );
  assert.deepEqual(packageDirectories(root), ["apps/example"]);
  assert.equal(
    runPackageCommands(root, ["run", "record", "--", "value with spaces"]),
    0,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(directory, "result.json"))),
    {
      cwd: directory,
      args: ["value with spaces"],
    },
  );
  assert.notEqual(runPackageCommands(root, ["run", "fail"]), 0);
  assert.equal(
    readFileSync(path.join(root, "apps/example/package.json"), "utf8").includes(
      "workspaces",
    ),
    false,
  );
});
