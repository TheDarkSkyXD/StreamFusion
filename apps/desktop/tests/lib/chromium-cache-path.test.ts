import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  pruneStaleChromiumDiskCaches,
  resolveChromiumDiskCachePath,
} from "@/lib/chromium-cache-path";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

// Guards: overlapping StreamFusion processes must never contend for Chromium's disposable disk cache or place it beside persistent profile data
describe("resolveChromiumDiskCachePath", () => {
  it("isolates each launch even when the operating system reuses a process ID", () => {
    const options = {
      tempPath: "C:\\Temp",
      userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\StreamFusion (Dev)",
      processId: 16040,
    };

    const first = resolveChromiumDiskCachePath({ ...options, launchId: "launch-one" });
    const second = resolveChromiumDiskCachePath({ ...options, launchId: "launch-two" });

    expect(first).not.toBe(second);
    expect(path.relative(options.tempPath, first)).not.toMatch(/^\.\.(?:[\\/]|$)/);
    expect(path.relative(options.userDataPath, first)).toMatch(/^\.\.(?:[\\/]|$)/);
  });

  it("removes only orphaned siblings inside the disposable cache root", async () => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), "streamfusion-cache-test-"));
    scratchDirectories.push(scratch);
    const userDataPath = path.join(scratch, "persistent-user-data");
    const cacheRoot = path.join(scratch, "disposable-cache");
    const currentCachePath = path.join(cacheRoot, "16040-a1");
    const activeCachePath = path.join(cacheRoot, "22108-b2");
    const orphanCachePath = path.join(cacheRoot, "16040-c3");
    await Promise.all(
      [userDataPath, currentCachePath, activeCachePath, orphanCachePath].map((directory) =>
        mkdir(directory, { recursive: true })
      )
    );

    await pruneStaleChromiumDiskCaches({
      cacheRoot,
      currentCachePath,
      userDataPath,
      isProcessRunning: (processId) => processId === 16040 || processId === 22108,
    });

    expect((await readdir(cacheRoot)).sort()).toEqual(["16040-a1", "22108-b2"]);
    await expect(readdir(userDataPath)).resolves.toEqual([]);
  });
});
