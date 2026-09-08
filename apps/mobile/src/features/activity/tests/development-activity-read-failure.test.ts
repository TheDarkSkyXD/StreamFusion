import { describe, expect, it, vi } from "vitest";

import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import { createDevelopmentActivityReadFailureProof } from "../adapters/development-activity-read-failure";

function repository(): ActivityRepository {
  return {
    dismissCompleted: async () => ({
      activeEventIds: [],
      alreadyDismissedEventIds: [],
      dismissedEventIds: [],
      missingEventIds: [],
    }),
    list: vi.fn(async () => []),
    markAllRead: async () => 0,
    markRead: async () => null,
    record: async (item) => ({ item, kind: "created" }),
  };
}

describe("development Activity read failure proof", () => {
  it("fails one repository read without changing later reads or mutations", async () => {
    const product = repository();
    const proof = createDevelopmentActivityReadFailureProof(product);

    expect(proof.queueNextListFailure()).toEqual({ kind: "queued" });
    await expect(proof.repository.list()).rejects.toThrow(
      "Development Activity list failure.",
    );
    await expect(proof.repository.list()).resolves.toEqual([]);
    expect(product.list).toHaveBeenCalledTimes(1);
  });
});
