import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Guards: the reliability checker must scan the current IPC source and contract directories without crashing on stale layout paths.
describe("reliability boundary checker", () => {
  it("runs against the current desktop source layout", () => {
    const result = spawnSync(process.execPath, ["scripts/check-reliability-boundaries.mjs"], {
      cwd: desktopRoot,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      directHandles: expect.any(Number),
      trustedRoutes: expect.any(Number),
      guardedLegacyRoutes: expect.any(Number),
    });
  });
});
