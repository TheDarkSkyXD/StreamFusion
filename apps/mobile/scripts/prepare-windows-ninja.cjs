const { createHash } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const version = "1.13.2";
const archiveChecksum =
  "07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65";

async function fetchArchive() {
  const response = await fetch(
    `https://github.com/ninja-build/ninja/releases/download/v${version}/ninja-win.zip`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok)
    throw new Error(`Ninja download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractArchive(archive, directory) {
  const result = spawnSync("tar.exe", ["-xf", archive, "-C", directory], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Ninja archive extraction failed");
}

async function prepareWindowsNinja(repositoryRoot, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") return null;
  const directory = path.join(repositoryRoot, ".cache", "ninja", version);
  const executable = path.join(directory, "ninja.exe");
  if (existsSync(executable)) return executable;

  const archive = await (options.fetchArchive ?? fetchArchive)();
  if (createHash("sha256").update(archive).digest("hex") !== archiveChecksum) {
    throw new Error(
      "Ninja archive checksum does not match the pinned official release",
    );
  }
  mkdirSync(directory, { recursive: true });
  const archivePath = path.join(directory, `ninja-${process.pid}.zip`);
  const stagingDirectory = path.join(directory, `extract-${process.pid}`);
  mkdirSync(stagingDirectory, { recursive: true });
  writeFileSync(archivePath, archive);
  try {
    (options.extractArchive ?? extractArchive)(archivePath, stagingDirectory);
    if (!existsSync(executable)) {
      renameSync(path.join(stagingDirectory, "ninja.exe"), executable);
    }
  } finally {
    rmSync(archivePath, { force: true });
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
  return executable;
}

module.exports = { prepareWindowsNinja };
