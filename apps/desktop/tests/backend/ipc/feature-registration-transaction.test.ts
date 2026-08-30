import { describe, expect, it, vi } from "vitest";

import {
  registerFeatureRollback,
  runFeatureRegistrationTransaction,
} from "@backend/ipc/feature-registration-transaction";

// Guards: a partial lazy-feature registration unwinds resources in reverse order before retry.
// Guards: successful feature registration retains its handlers and lifecycle resources.
describe("feature registration transaction", () => {
  it("rolls back a failed registration in reverse order", async () => {
    const calls: string[] = [];

    await expect(
      runFeatureRegistrationTransaction(async () => {
        registerFeatureRollback(() => {
          calls.push("first");
        });
        registerFeatureRollback(() => {
          calls.push("second");
        });
        throw new Error("registration failed");
      })
    ).rejects.toThrow("registration failed");

    expect(calls).toEqual(["second", "first"]);
  });

  it("does not roll back a successful registration", async () => {
    const rollback = vi.fn();

    await runFeatureRegistrationTransaction(async () => {
      registerFeatureRollback(rollback);
    });

    expect(rollback).not.toHaveBeenCalled();
  });
});
