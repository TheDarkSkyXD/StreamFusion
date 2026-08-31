import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const relayRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(relayRoot, "../..");
const wranglerBin = path.join(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js"
);
const outputRoot = await mkdtemp(
  path.join(tmpdir(), "streamfusion-relay-dry-run-")
);

try {
  for (const environment of ["development", "production"]) {
    const outputDirectory = path.join(outputRoot, environment);
    const result = spawnSync(
      process.execPath,
      [
        wranglerBin,
        "deploy",
        "--dry-run",
        "--env",
        environment,
        "--outdir",
        outputDirectory
      ],
      {
        cwd: relayRoot,
        encoding: "utf8"
      }
    );

    assert.equal(
      result.status,
      0,
      `${environment} dry run failed:\n${result.stdout}\n${result.stderr}`
    );
    const outputFiles = await readdir(outputDirectory);
    assert.ok(
      outputFiles.length > 0,
      `${environment} dry run emitted no files`
    );
    const sizes = await Promise.all(
      outputFiles.map(
        async (file) => (await stat(path.join(outputDirectory, file))).size
      )
    );
    assert.ok(
      sizes.some((size) => size > 0),
      `${environment} dry run emitted only empty files`
    );
  }
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

console.log("Relay dry run passed for development and production.");
