import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** @param {string} repositoryRoot @param {readonly string[]} files */
export async function buildLockfileDigest(repositoryRoot, files) {
  const entries = await Promise.all(
    files.toSorted().map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(path.join(repositoryRoot, file)))
        .digest("hex"),
    ])
  );
  const lockfiles = Object.fromEntries(entries);
  return {
    lockfiles,
    lockfileSha256: createHash("sha256").update(JSON.stringify(lockfiles)).digest("hex"),
  };
}
