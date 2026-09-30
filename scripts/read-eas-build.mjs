import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

function requireValue(value, label) {
  if (!value) {
    throw new Error(`EAS build metadata is missing ${label}`);
  }
  return value;
}

/**
 * Confirm an EAS build was produced by the expected profile from the expected
 * commit before anything is downloaded, so a stale or unrelated build is never
 * promoted into a release.
 */
export function readEasBuild({ metadata, expectedCommit, expectedProfile }) {
  const build = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  if (!build || typeof build !== "object") {
    throw new Error("EAS build metadata is not an object");
  }

  const commit = requireValue(
    build.gitCommit ?? build.commitHash,
    "git commit",
  );
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error(
      `EAS built commit ${commit} but the release tag points at ${expectedCommit}. Refusing to promote a build from a different commit.`,
    );
  }

  const profile = requireValue(
    build.buildProfile ?? build.profile,
    "build profile",
  );
  if (expectedProfile && profile !== expectedProfile) {
    throw new Error(
      `EAS used profile ${profile}, expected ${expectedProfile}. A release must be built by the production profile so it carries the production application id.`,
    );
  }

  const artifacts = build.artifacts ?? [];
  const artifact = artifacts[0];
  return {
    build_id: requireValue(build.id ?? build.buildId, "build id"),
    build_url: build.url ?? `https://expo.dev/artifacts/eas/${build.id ?? build.buildId}`,
    artifact_url: requireValue(
      artifact?.url ?? build.artifactUrl,
      "artifact URL",
    ),
  };
}

function runCli() {
  const [, , metadataPath, outputPath] = process.argv;
  if (!metadataPath || !outputPath) {
    throw new Error(
      "usage: node scripts/read-eas-build.mjs <eas-build.json> <github-output-path>",
    );
  }

  const build = readEasBuild({
    metadata: readFileSync(metadataPath, "utf8"),
    expectedCommit: process.env.RELEASE_COMMIT,
    expectedProfile: "production",
  });
  appendFileSync(
    outputPath,
    [
      `build_id=${build.build_id}`,
      `build_url=${build.build_url}`,
      `artifact_url=${build.artifact_url}`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
