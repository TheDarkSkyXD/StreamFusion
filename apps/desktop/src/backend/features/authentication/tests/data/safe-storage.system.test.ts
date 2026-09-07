import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "round-trips synthetic credentials through real Electron Windows secure storage",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-safe-storage-"));
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}streamfusion-safe-storage-`))
      throw new Error("Unexpected synthetic test directory");
    try {
      const script = join(directory, "probe.cjs");
      writeFileSync(
        script,
        `
      const { app, safeStorage } = require("electron");
      const { mkdirSync } = require("node:fs");
      const { join } = require("node:path");
      const profile = join(__dirname, "profile");
      mkdirSync(profile);
      app.setPath("userData", profile);
      app.disableHardwareAcceleration();
      app.whenReady().then(() => {
        const available = safeStorage.isEncryptionAvailable();
        if (!available) throw new Error("Secure storage unavailable");
        const synthetic = "StreamFusion synthetic safeStorage contract";
        const encrypted = safeStorage.encryptString(synthetic);
        const result = {
          available,
          encrypted: !encrypted.equals(Buffer.from(synthetic)),
          roundTrip: safeStorage.decryptString(encrypted) === synthetic,
        };
        process.stdout.write(JSON.stringify(result));
        app.exit(0);
      }).catch(() => { process.stderr.write("Synthetic secure storage contract failed"); app.exit(1); });
    `
      );
      const electron: string = createRequire(import.meta.url)("electron");
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(electron, [script], {
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        JSON.stringify({ available: true, encrypted: true, roundTrip: true })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  25_000
);
