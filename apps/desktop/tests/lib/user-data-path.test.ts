import { describe, expect, it } from "vitest";

import { resolveUserDataPath } from "@backend/utility/user-data-path";

// Guards: an explicit launch profile must reach SQLite unchanged instead of being redirected to the shared development profile
describe("resolveUserDataPath", () => {
  it("uses an explicit user-data directory in development", () => {
    expect(
      resolveUserDataPath({
        argv: ["electron.exe", ".", "--user-data-dir=C:\\proof-profile"],
        defaultPath: "C:\\StreamFusion",
        isProduction: false,
      })
    ).toBe("C:\\proof-profile");
  });

  it("accepts a user-data directory passed as a separate argument", () => {
    expect(
      resolveUserDataPath({
        argv: ["StreamFusion.exe", "--user-data-dir", "C:\\packaged-proof"],
        defaultPath: "C:\\StreamFusion",
        isProduction: true,
      })
    ).toBe("C:\\packaged-proof");
  });

  it("keeps the automatic development suffix when no override is supplied", () => {
    expect(
      resolveUserDataPath({
        argv: ["electron.exe", "."],
        defaultPath: "C:\\StreamFusion",
        isProduction: false,
      })
    ).toBe("C:\\StreamFusion (Dev)");
  });
});
