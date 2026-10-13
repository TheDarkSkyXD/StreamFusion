import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ninjaSetup from "../scripts/prepare-windows-ninja.cjs";

const { prepareWindowsNinja } = ninjaSetup;
const fixtureRoot = path.resolve(".scratch/tests/ninja-setup");
mkdirSync(fixtureRoot, { recursive: true });

test("Windows native setup rejects an unverified download before extracting it", async (t) => {
  const root = mkdtempSync(path.join(fixtureRoot, "invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let extracted = false;
  await assert.rejects(
    prepareWindowsNinja(root, {
      platform: "win32",
      fetchArchive: async () => Buffer.from("unexpected archive"),
      extractArchive: () => {
        extracted = true;
      },
    }),
    /checksum/u,
  );
  assert.equal(extracted, false);
});

test("Windows native setup reuses the project-local Ninja without a download", async (t) => {
  const root = mkdtempSync(path.join(fixtureRoot, "cached-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, ".cache/ninja/1.13.2/ninja.exe");
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, "cached tool");
  assert.equal(
    await prepareWindowsNinja(root, {
      platform: "win32",
      fetchArchive: () => {
        throw new Error("Unexpected download");
      },
    }),
    executable,
  );
});

test("native dependency setup skips the Windows tool on other platforms", async () => {
  assert.equal(
    await prepareWindowsNinja(fixtureRoot, {
      platform: "linux",
      fetchArchive: () => {
        throw new Error("Unexpected download");
      },
    }),
    null,
  );
});
