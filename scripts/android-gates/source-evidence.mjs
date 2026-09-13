import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { isFresh, matchesBinding } from "./freshness.mjs";

function fail(now, detail) {
  return { kind: "fail", observedAt: now, artifacts: [], detail };
}

function repositoryRelative(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    !path.posix.isAbsolute(relativePath) &&
    !path.win32.isAbsolute(relativePath) &&
    !relativePath.split(/[\\/]/u).includes("..")
  );
}

export async function sourceEvidenceFill(relativePath, slot, context) {
  const now = context.now;
  if (!repositoryRelative(relativePath)) {
    return fail(now, "source evidence path must be repository-relative");
  }
  const root = path.resolve(context.repositoryRoot);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return fail(now, "source evidence resolved outside the repository");
  }
  let content;
  try {
    const metadata = await stat(absolutePath);
    if (!metadata.isFile() || metadata.size === 0) {
      return fail(now, "source evidence must be a non-empty file");
    }
    content = await readFile(absolutePath);
  } catch {
    return fail(now, `source evidence file does not exist: ${relativePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return fail(now, "source evidence must be JSON");
  }
  if (parsed?.result !== "pass") {
    return fail(now, "source evidence result must be pass");
  }
  if (typeof parsed.observedAt !== "string" || !Number.isFinite(Date.parse(parsed.observedAt))) {
    return fail(now, "source evidence must include observedAt");
  }
  const record = {
    observedAt: parsed.observedAt,
    sourceCommit: parsed.sourceCommit,
    apkDigest: parsed.apkDigest ?? null,
  };
  if (!isFresh(slot, record, now, context.policy)) {
    return fail(now, "source evidence is stale");
  }
  if (slot.binding !== "none" && !matchesBinding(slot, record, context)) {
    return fail(now, "source evidence identity does not match this run");
  }
  return {
    kind: "pass",
    observedAt: parsed.observedAt,
    apkDigest: context.apkDigest,
    artifacts: [
      {
        id: "source-evidence",
        path: relativePath.split(path.sep).join("/"),
        sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        mediaType: "application/json",
      },
    ],
  };
}
