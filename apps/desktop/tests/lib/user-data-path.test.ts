import { describe, expect, it } from "vitest";

import { resolveUserDataPath } from "@backend/utility/user-data-path";

// Guards: explicit launch profiles override the automatic development and packaged locations
// Guards: packaged launches keep Electron's production user-data directory
// Guards: development launches use the project-local user-data directory
describe("resolveUserDataPath", () => {
  it("uses an explicit user-data directory in development", () => {
    expect(
      resolveUserDataPath({
        argv: ["electron.exe", ".", "--user-data-dir=C:\\proof-profile"],
        defaultPath: "C:\\StreamFusion",
        developmentPath: "C:\\repo\\.streamfusion-dev-user-data",
        isProduction: false,
      })
    ).toBe("C:\\proof-profile");
  });

  it("accepts a user-data directory passed as a separate argument", () => {
    expect(
      resolveUserDataPath({
        argv: ["StreamFusion.exe", "--user-data-dir", "C:\\packaged-proof"],
        defaultPath: "C:\\StreamFusion",
        developmentPath: "C:\\repo\\.streamfusion-dev-user-data",
        isProduction: true,
      })
    ).toBe("C:\\packaged-proof");
  });

  it("keeps Electron's default user-data directory in production", () => {
    expect(
      resolveUserDataPath({
        argv: ["StreamFusion.exe"],
        defaultPath: "C:\\StreamFusion",
        developmentPath: "C:\\repo\\.streamfusion-dev-user-data",
        isProduction: true,
      })
    ).toBe("C:\\StreamFusion");
  });

  it("uses the project-local user-data directory in development", () => {
    expect(
      resolveUserDataPath({
        argv: ["electron.exe", "."],
        defaultPath: "C:\\StreamFusion",
        developmentPath: "C:\\repo\\.streamfusion-dev-user-data",
        isProduction: false,
      })
    ).toBe("C:\\repo\\.streamfusion-dev-user-data");
  });
});
