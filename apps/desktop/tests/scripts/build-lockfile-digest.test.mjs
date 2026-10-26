import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildLockfileDigest } from "../../scripts/build-lockfile-digest.mjs";

test("build provenance covers every input lockfile in a stable order", async (t) => {
  const scratch = path.resolve(import.meta.dirname, "../../.tmp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, "lockfile-digest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ["desktop-lock.json", "core-lock.json"];
  for (const file of files) writeFileSync(path.join(root, file), "{}");
  const original = await buildLockfileDigest(root, files);
  assert.deepEqual(await buildLockfileDigest(root, files.toReversed()), original);
  for (const file of files) {
    writeFileSync(path.join(root, file), '{"changed":true}');
    assert.notEqual(
      (await buildLockfileDigest(root, files)).lockfileSha256,
      original.lockfileSha256
    );
    writeFileSync(path.join(root, file), "{}");
  }
  assert.deepEqual(Object.keys(original.lockfiles), ["core-lock.json", "desktop-lock.json"]);
  await assert.rejects(buildLockfileDigest(root, ["missing.json"]), { code: "ENOENT" });
});
