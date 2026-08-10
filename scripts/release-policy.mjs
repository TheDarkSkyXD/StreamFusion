import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateReleaseTag({ tag, version }) {
  if (tag !== `v${version}`) {
    throw new Error(`release tag ${tag} must exactly match desktop version v${version}`);
  }

  if (/^\d+\.\d+\.\d+$/.test(version)) {
    return { version, prerelease: false, prereleaseLabel: "" };
  }

  const prereleaseMatch = version.match(/^\d+\.\d+\.\d+-(alpha|beta|rc)\.\d+$/);
  if (!prereleaseMatch) {
    throw new Error(`unsupported release version: ${version}`);
  }

  const labels = {
    alpha: "Alpha",
    beta: "Beta",
    rc: "Release Candidate",
  };
  return {
    version,
    prerelease: true,
    prereleaseLabel: labels[prereleaseMatch[1]],
  };
}

function runCli() {
  const [, , tag, outputPath] = process.argv;
  if (!tag || !outputPath) {
    throw new Error("usage: node scripts/release-policy.mjs <tag> <github-output-path>");
  }

  const packagePath = fileURLToPath(new URL("../apps/desktop/package.json", import.meta.url));
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const release = validateReleaseTag({ tag, version });
  appendFileSync(
    outputPath,
    [
      `release_tag=${tag}`,
      `version=${release.version}`,
      `prerelease=${release.prerelease}`,
      `prerelease_label=${release.prereleaseLabel}`,
      "",
    ].join("\n")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
