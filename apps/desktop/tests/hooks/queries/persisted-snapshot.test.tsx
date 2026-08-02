import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { savePersistedSnapshot, usePersistedSnapshot } from "@/hooks/queries/persisted-snapshot";
import { installElectronAPIMock } from "../../test-utils";

let api: ReturnType<typeof installElectronAPIMock>;

beforeEach(() => {
  api = installElectronAPIMock();
});

// Guards: persisted browse snapshots hydrate only for an exact identity, inside TTL, with usable non-empty data.
// Guards: snapshot writes retain identity and timestamp in one bounded storage slot.
describe("persisted browse snapshots", () => {
  it("hydrates an exact fresh non-empty snapshot", async () => {
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity: JSON.stringify({ query: "xqc", platform: "kick" }),
      savedAt: Date.now(),
      data: [{ id: "result-1" }],
    }));

    const { result } = renderHook(() =>
      usePersistedSnapshot<Array<{ id: string }>>({
        slot: "search:kick",
        identity: { query: "xqc", platform: "kick" },
        maxAgeMs: 60_000,
        isUsable: (data) => data.length > 0,
      })
    );

    await waitFor(() => expect(result.current).toEqual([{ id: "result-1" }]));
  });

  it.each([
    ["wrong identity", JSON.stringify({ query: "other", platform: "kick" }), Date.now()],
    ["expired", JSON.stringify({ query: "xqc", platform: "kick" }), Date.now() - 60_001],
  ])("rejects %s snapshots", async (_label, identity, savedAt) => {
    api.store.get = vi.fn(async () => ({
      version: 1,
      identity,
      savedAt,
      data: [{ id: "stale" }],
    }));

    const { result } = renderHook(() =>
      usePersistedSnapshot<Array<{ id: string }>>({
        slot: "search:kick",
        identity: { query: "xqc", platform: "kick" },
        maxAgeMs: 60_000,
        isUsable: (data) => data.length > 0,
      })
    );

    await waitFor(() => expect(api.store.get).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("writes a versioned snapshot to the bounded slot", async () => {
    api.store.set = vi.fn(async () => undefined);
    vi.spyOn(Date, "now").mockReturnValue(1234);

    await savePersistedSnapshot("categories:all", "all", [{ id: "cat-1" }]);

    expect(api.store.set).toHaveBeenCalledWith("browse-query-snapshot:v1:categories:all", {
      version: 1,
      identity: JSON.stringify("all"),
      savedAt: 1234,
      data: [{ id: "cat-1" }],
    });
  });
});
