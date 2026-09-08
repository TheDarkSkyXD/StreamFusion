import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha256Pattern = /^[a-f0-9]{64}$/;

function contained(repositoryRoot, candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function verifyReceiptArtifacts({ repositoryRoot, receiptPath }) {
  const root = await realpath(repositoryRoot);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (!Array.isArray(receipt.evidenceArtifacts)) {
    throw new Error("receipt.evidenceArtifacts must be an array");
  }
  if (receipt.evidenceArtifacts.length === 0) {
    throw new Error("receipt.evidenceArtifacts must not be empty");
  }

  for (const [index, artifact] of receipt.evidenceArtifacts.entries()) {
    const location = `receipt.evidenceArtifacts[${index}]`;
    if (typeof artifact?.path !== "string" || artifact.path.length === 0) {
      throw new Error(`${location}.path must be a non-empty string`);
    }
    if (!sha256Pattern.test(artifact.sha256)) {
      throw new Error(
        `${location}.sha256 must be 64 lowercase hexadecimal characters`,
      );
    }

    const requested = path.resolve(root, artifact.path);
    if (!contained(root, requested)) {
      throw new Error(`${location}.path escapes the repository`);
    }
    let actualPath;
    try {
      actualPath = await realpath(requested);
    } catch {
      throw new Error(`${location}.path does not exist`);
    }
    if (!contained(root, actualPath)) {
      throw new Error(`${location}.path resolves outside the repository`);
    }
    if (!(await stat(actualPath)).isFile()) {
      throw new Error(`${location}.path must identify a file`);
    }

    const actual = createHash("sha256")
      .update(await readFile(actualPath))
      .digest("hex");
    if (actual !== artifact.sha256) {
      throw new Error(`${location}.sha256 does not match ${artifact.path}`);
    }
  }

  return { verified: receipt.evidenceArtifacts.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const receiptPath = process.argv[2];
  if (!receiptPath)
    throw new Error(
      "Usage: node verification/verify-receipt-artifacts.mjs <receipt.json>",
    );
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = await verifyReceiptArtifacts({ repositoryRoot, receiptPath });
  console.log(
    `Receipt artifact verification passed. ${result.verified} verified.`,
  );
}
