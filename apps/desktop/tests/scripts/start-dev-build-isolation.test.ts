import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDevelopmentRun,
  createElectronViteArguments,
} from "../../scripts/start-dev-run-lib.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Guards: a second development compiler cannot delete lazy main-process chunks owned by an already-running start
// Guards: isolated starts retain separately built utility processes used by local captions
describe("development build isolation", () => {
  it("keeps each start's package and delayed chunks in a private output directory", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "streamfusion-dev-run-test-"));
    cleanups.push(() =>
      rm(projectDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    );
    const manifest = {
      name: "streamfusion-test",
      version: "1.2.3",
      main: "out/main/index.js",
    };
    await mkdir(path.join(projectDir, "assets", "icons"), { recursive: true });
    await writeFile(path.join(projectDir, "package.json"), JSON.stringify(manifest));
    await writeFile(path.join(projectDir, "assets", "icons", "icon.ico"), "test-icon");
    await mkdir(path.join(projectDir, "out", "utility"), { recursive: true });
    await writeFile(
      path.join(projectDir, "out", "utility", "caption-recognizer.cjs"),
      'module.exports = "captions";\n'
    );

    const first = await createDevelopmentRun(projectDir);
    const second = await createDevelopmentRun(projectDir);
    cleanups.push(first.cleanup, second.cleanup);

    await mkdir(path.join(first.outDir, "main", "chunks"), { recursive: true });
    await writeFile(
      path.join(first.outDir, "main", "index.js"),
      'exports.loadLazy = () => Promise.resolve().then(() => require("./chunks/lazy.js"));\n'
    );
    await writeFile(
      path.join(first.outDir, "main", "chunks", "lazy.js"),
      'module.exports = "first";\n'
    );

    const firstMain = require(path.join(first.outDir, "main", "index.js"));

    await rm(second.outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await mkdir(path.join(second.outDir, "main", "chunks"), { recursive: true });
    await writeFile(
      path.join(second.outDir, "main", "chunks", "lazy.js"),
      'module.exports = "second";\n'
    );

    await expect(firstMain.loadLazy()).resolves.toBe("first");
    await expect(
      readFile(path.join(first.outDir, "utility", "caption-recognizer.cjs"), "utf8")
    ).resolves.toContain('module.exports = "captions"');
    expect(second.outDir).not.toBe(first.outDir);
    const copiedManifest = JSON.parse(
      await readFile(path.join(first.appDir, "package.json"), "utf8")
    );
    expect(copiedManifest).toMatchObject(manifest);
    await expect(
      readFile(path.join(first.appDir, "assets", "icons", "icon.ico"))
    ).resolves.not.toHaveLength(0);
  });

  it("keeps Electron arguments after the isolated compiler options", () => {
    expect(
      createElectronViteArguments(["--watch", "--", "--remote-debugging-port=9222"], {
        appDir: "private-app",
        outDir: "private-out",
      })
    ).toEqual([
      "dev",
      "--watch",
      "--outDir",
      "private-out",
      "--entry",
      "private-app",
      "--",
      "--remote-debugging-port=9222",
    ]);
  });
});
