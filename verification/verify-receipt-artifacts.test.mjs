import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyReceiptArtifacts } from "./verify-receipt-artifacts.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function fixture(t, change = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "receipt-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "evidence"));
  const artifactPath = path.join(root, "evidence", "screen.png");
  await writeFile(artifactPath, "screen");
  const sha256 = createHash("sha256").update("screen").digest("hex");
  const receipt = {
    evidenceArtifacts: [{ path: "evidence/screen.png", sha256, ...change }],
  };
  const receiptPath = path.join(root, "receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt));
  return { receiptPath, root };
}

async function removeLink(linkPath) {
  let stats;
  try {
    stats = await lstat(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!stats.isSymbolicLink()) return;
  try {
    await rmdir(linkPath);
  } catch (error) {
    if (error?.code !== "ENOTDIR" && error?.code !== "EISDIR") throw error;
    await unlink(linkPath);
  }
}

test("verifies every receipt artifact against its bytes", async (t) => {
  const input = await fixture(t);
  const result = await verifyReceiptArtifacts({
    repositoryRoot: input.root,
    receiptPath: input.receiptPath,
  });
  assert.deepEqual(result, { verified: 1 });
});

test("rejects malformed and mismatched digests", async (t) => {
  const malformed = await fixture(t, { sha256: `${"0".repeat(64)}e` });
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: malformed.root,
      receiptPath: malformed.receiptPath,
    }),
    /64 lowercase hexadecimal/,
  );
  const mismatch = await fixture(t, { sha256: "0".repeat(64) });
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: mismatch.root,
      receiptPath: mismatch.receiptPath,
    }),
    /does not match/,
  );
});

test("rejects empty, missing, non-file, and escaping artifacts", async (t) => {
  const empty = await fixture(t);
  await writeFile(empty.receiptPath, JSON.stringify({ evidenceArtifacts: [] }));
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: empty.root,
      receiptPath: empty.receiptPath,
    }),
    /must not be empty/,
  );

  const missing = await fixture(t, { path: "evidence/missing.png" });
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: missing.root,
      receiptPath: missing.receiptPath,
    }),
    /does not exist/,
  );
  const nonFile = await fixture(t, { path: "evidence" });
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: nonFile.root,
      receiptPath: nonFile.receiptPath,
    }),
    /must identify a file/,
  );

  const escaping = await fixture(t, { path: "../outside.png" });
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: escaping.root,
      receiptPath: escaping.receiptPath,
    }),
    /escapes the repository/,
  );
});

test("rejects a directory junction that resolves outside the repository", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "receipt-artifacts-"));
  const outside = await mkdtemp(path.join(tmpdir(), "receipt-outside-"));
  const evidence = path.join(root, "evidence");
  const link = path.join(evidence, "outside-dir");
  t.after(async () => {
    await removeLink(link);
    await rm(outside, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(evidence);
  const target = path.join(outside, "screen.png");
  await writeFile(target, "screen");
  await symlink(outside, link, "junction");
  const receiptPath = path.join(root, "receipt.json");
  await writeFile(
    receiptPath,
    JSON.stringify({
      evidenceArtifacts: [
        {
          path: "evidence/outside-dir/screen.png",
          sha256: createHash("sha256").update("screen").digest("hex"),
        },
      ],
    }),
  );
  await assert.rejects(
    verifyReceiptArtifacts({
      repositoryRoot: root,
      receiptPath,
    }),
    /resolves outside the repository/,
  );
});

test("verifies the checked-in issue 145 receipt", async () => {
  const result = await verifyReceiptArtifacts({
    repositoryRoot,
    receiptPath: path.join(
      repositoryRoot,
      "verification",
      "evidence",
      "issue-145-twitch-account.json",
    ),
  });
  assert.deepEqual(result, { verified: 4 });
});
