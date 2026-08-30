import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerLoadedFeatureCleanup,
  runLoadedFeatureCleanups,
} from "@backend/startup/loaded-feature-cleanup";
import { runFeatureRegistrationTransaction } from "@backend/ipc/feature-registration-transaction";

afterEach(async () => {
  await runLoadedFeatureCleanups();
});

// Guards: failed lazy-feature registration runs and removes newly registered lifecycle cleanup.
// Guards: successful lazy-feature registration retains cleanup until process shutdown.
describe("loaded feature cleanup registration", () => {
  it("rolls back cleanup registered by a failed feature", async () => {
    const cleanup = vi.fn();

    await expect(
      runFeatureRegistrationTransaction(async () => {
        registerLoadedFeatureCleanup("test:failed", cleanup);
        throw new Error("registration failed");
      })
    ).rejects.toThrow("registration failed");

    expect(cleanup).toHaveBeenCalledOnce();
    await runLoadedFeatureCleanups();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("retains cleanup registered by a successful feature", async () => {
    const cleanup = vi.fn();

    await runFeatureRegistrationTransaction(async () => {
      registerLoadedFeatureCleanup("test:success", cleanup);
    });

    expect(cleanup).not.toHaveBeenCalled();
    await runLoadedFeatureCleanups();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
