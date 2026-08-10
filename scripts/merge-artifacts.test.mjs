import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";

const mergeScript = path.resolve(".github/scripts/merge_artifacts.js");
const version = "1.2.3";

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "streamfusion-release-assets-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeArtifact(root, artifactName, filename, content = filename) {
  const directory = path.join(root, "artifacts", artifactName);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), content);
}

function merge(root) {
  return spawnSync(process.execPath, [mergeScript, version], {
    cwd: root,
    encoding: "utf8",
  });
}

function updaterMetadata(filename, content, releaseDate = "2026-08-05T12:00:00.000Z") {
  const bytes = Buffer.from(content);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  return dumpYaml({
    version,
    files: [{ url: filename, sha512, size: bytes.length }],
    path: filename,
    sha512,
    releaseDate,
  });
}

async function writeCompleteFixture(root) {
  const windowsInstaller = `StreamFusion-${version}-Setup.exe`;
  const windowsContent = "windows-installer";
  await writeArtifact(root, "streamfusion-windows-x64", windowsInstaller, windowsContent);
  await writeArtifact(
    root,
    "streamfusion-windows-x64",
    `${windowsInstaller}.blockmap`,
    "windows-blockmap"
  );
  await writeArtifact(
    root,
    "streamfusion-windows-x64",
    "latest.yml",
    updaterMetadata(windowsInstaller, windowsContent)
  );

  for (const architecture of ["x64", "arm64"]) {
    const artifactName = `streamfusion-macos-${architecture}`;
    const diskImage = `StreamFusion-${version}-${architecture}.dmg`;
    const archive = `StreamFusion-${version}-${architecture}.zip`;
    const archiveContent = `macos-${architecture}-archive`;
    await writeArtifact(root, artifactName, diskImage, `macos-${architecture}-dmg`);
    await writeArtifact(root, artifactName, archive, archiveContent);
    await writeArtifact(
      root,
      artifactName,
      "latest-mac.yml",
      updaterMetadata(archive, archiveContent)
    );
  }
}

test("fails when a required Windows blockmap is missing", async () => {
  await withFixture(async (root) => {
    await writeArtifact(root, "streamfusion-windows-x64", `StreamFusion-${version}-Setup.exe`);

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required artifact.*\.exe\.blockmap/i);
  });
});

test("rejects builder debug output instead of publishing it", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await writeArtifact(
      root,
      "streamfusion-windows-x64",
      "builder-debug.yml",
      "debug: true\n"
    );

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected release artifact.*builder-debug\.yml/i);
  });
});

test("cleans stale release output before preparing a complete asset set", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await mkdir(path.join(root, "release-assets"), { recursive: true });
    await writeFile(path.join(root, "release-assets", "stale-file.txt"), "stale");

    const result = merge(root);

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch((await readdir(path.join(root, "release-assets"))).join("\n"), /stale/);
  });
});

test("fails instead of publishing malformed updater metadata", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await writeArtifact(root, "streamfusion-windows-x64", "latest.yml", "files: [unterminated");

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid updater metadata.*latest\.yml/i);
  });
});

test("rejects updater metadata for a different application version", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    const installer = `StreamFusion-${version}-Setup.exe`;
    await writeArtifact(
      root,
      "streamfusion-windows-x64",
      "latest.yml",
      updaterMetadata(installer, "windows-installer").replace(`version: ${version}`, "version: 9.9.9")
    );

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /metadata version 9\.9\.9 does not match release 1\.2\.3/i);
  });
});

test("rejects updater metadata that references an asset outside the release set", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await writeArtifact(
      root,
      "streamfusion-windows-x64",
      "latest.yml",
      updaterMetadata("missing-installer.exe", "missing")
    );

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /metadata references missing asset missing-installer\.exe/i);
  });
});

test("rejects conflicting metadata for the same updater asset URL", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    const x64Archive = `StreamFusion-${version}-x64.zip`;
    const conflicting = loadYaml(updaterMetadata(x64Archive, "macos-x64-archive"));
    conflicting.files[0].blockMapSize = 999;
    await writeArtifact(
      root,
      "streamfusion-macos-arm64",
      "latest-mac.yml",
      dumpYaml(conflicting)
    );

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conflicting updater metadata.*x64\.zip/i);
  });
});

test("rejects updater metadata whose SHA-512 does not match the referenced asset", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    const installer = `StreamFusion-${version}-Setup.exe`;
    const tampered = loadYaml(updaterMetadata(installer, "windows-installer"));
    tampered.files[0].sha512 = `${"A".repeat(86)}==`;
    tampered.sha512 = tampered.files[0].sha512;
    await writeArtifact(
      root,
      "streamfusion-windows-x64",
      "latest.yml",
      dumpYaml(tampered)
    );

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /metadata sha512 does not match asset.*Setup\.exe/i);
  });
});

test("rejects incomplete or inconsistent top-level updater integrity fields", async () => {
  for (const variant of ["missing-sha512", "mismatched-sha512"]) {
    await withFixture(async (root) => {
      await writeCompleteFixture(root);
      const installer = `StreamFusion-${version}-Setup.exe`;
      const metadata = loadYaml(updaterMetadata(installer, "windows-installer"));
      if (variant === "missing-sha512") {
        delete metadata.sha512;
      } else {
        metadata.sha512 = `${"A".repeat(86)}==`;
      }
      await writeArtifact(
        root,
        "streamfusion-windows-x64",
        "latest.yml",
        dumpYaml(metadata)
      );

      const result = merge(root);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /top-level metadata path and sha512 must match files\[\]/i);
    });
  }
});

test("merges macOS updater metadata in deterministic URL order with the latest release date", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await writeArtifact(
      root,
      "streamfusion-macos-x64",
      "latest-mac.yml",
      updaterMetadata(
        `StreamFusion-${version}-x64.zip`,
        "macos-x64-archive",
        "2026-08-05T13:00:00.000Z"
      )
    );
    await writeArtifact(
      root,
      "streamfusion-macos-arm64",
      "latest-mac.yml",
      updaterMetadata(
        `StreamFusion-${version}-arm64.zip`,
        "macos-arm64-archive",
        "2026-08-05T12:00:00.000Z"
      )
    );

    const result = merge(root);

    assert.equal(result.status, 0, result.stderr);
    const metadata = loadYaml(
      await readFile(path.join(root, "release-assets", "latest-mac.yml"), "utf8")
    );
    assert.deepEqual(
      metadata.files.map((file) => file.url),
      [
        `StreamFusion-${version}-arm64.zip`,
        `StreamFusion-${version}-x64.zip`,
      ]
    );
    assert.equal(metadata.releaseDate, "2026-08-05T13:00:00.000Z");
  });
});

test("rejects unexpected artifact bundles", async () => {
  await withFixture(async (root) => {
    await writeCompleteFixture(root);
    await writeArtifact(root, "streamfusion-unknown", "surprise.exe");

    const result = merge(root);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected artifact bundle.*streamfusion-unknown/i);
  });
});
