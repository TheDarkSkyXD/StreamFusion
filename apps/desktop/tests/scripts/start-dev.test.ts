import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { createStartEnvironment } from "../../scripts/start-dev-lib.js";
import { createElectronViteArguments } from "../../scripts/start-dev-run-lib.js";

// Guards: option 2 gives Vite and Electron the same private per-run relay capability
// without changing the environment used by Electron-only starts.
// Guards: the real launcher replaces inherited artwork with a persistent icon shared with executable branding.
describe("development start environment", () => {
  it("passes the checked-in icon to both branding and the spawned development runtime", async () => {
    const launcherPath = path.resolve(__dirname, "../../scripts/start-dev.js");
    const launcherRequire = createRequire(launcherPath);
    const prepareBrandedElectronExecutable = vi.fn(async () => "C:\\runtime\\electron.exe");
    const environment = await new Promise<NodeJS.ProcessEnv>((resolve, reject) => {
      const dependencies: Record<string, unknown> = {
        "node:child_process": {
          spawn: (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
            resolve(options.env);
            return { on: vi.fn() };
          },
        },
        "./prepare-dev-electron-lib": { prepareBrandedElectronExecutable },
        "./start-dev-run-lib": {
          createElectronViteArguments,
          createDevelopmentRun: async () => ({ appDir: "temporary-app", outDir: "temporary-out" }),
        },
        electron: "C:\\electron\\electron.exe",
      };

      runInNewContext(readFileSync(launcherPath, "utf8"), {
        require: Object.assign((id: string) => dependencies[id] ?? launcherRequire(id), {
          resolve: launcherRequire.resolve,
        }),
        __dirname: path.dirname(launcherPath),
        process: {
          env: { STREAMFUSION_DEV_ICON_PATH: "C:\\deleted-run\\icon.ico" },
          argv: [process.execPath, launcherPath],
          execPath: process.execPath,
          exit: (code: number) => reject(new Error(`Launcher exited with ${code}`)),
        },
        console,
      });
    });

    const sourceIcon = path.resolve(__dirname, "../../assets/icons/icon.ico");
    expect(environment.STREAMFUSION_DEV_ICON_PATH).toBe(sourceIcon);
    expect(prepareBrandedElectronExecutable).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ iconPath: sourceIcon })
    );
  });

  it("adds a selected loopback port and per-run token only for browser development", async () => {
    const selectPort = vi.fn(async () => 54_321);
    const createToken = vi.fn(() => "fresh-private-token");

    await expect(
      createStartEnvironment(
        { BASE: "preserved", STREAMFUSION_BROWSER_DEV: "1" },
        { selectPort, createToken }
      )
    ).resolves.toMatchObject({
      BASE: "preserved",
      STREAMFUSION_BROWSER_DEV: "1",
      VITE_STREAMFUSION_BROWSER_DEV: "1",
      STREAMFUSION_DEV_RELAY_PORT: "54321",
      STREAMFUSION_DEV_RELAY_TOKEN: "fresh-private-token",
    });

    const electronOnly = await createStartEnvironment(
      { BASE: "preserved" },
      { selectPort, createToken }
    );
    expect(electronOnly).toEqual({ BASE: "preserved" });
    expect(selectPort).toHaveBeenCalledOnce();
    expect(createToken).toHaveBeenCalledOnce();
  });
});
