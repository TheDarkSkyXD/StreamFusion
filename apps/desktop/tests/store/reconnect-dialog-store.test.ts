import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

function resetStore() {
  useReconnectDialogStore.setState({
    isOpen: false,
    platform: "twitch",
    phase: "idle",
    missingScopes: [],
    onReconnected: null,
  });
}

beforeEach(() => resetStore());

describe("reconnect-dialog-store open", () => {
  it("sets isOpen and missingScopes from the payload", () => {
    useReconnectDialogStore.getState().open({
      missingScopes: ["channel:manage:polls"],
    });
    const s = useReconnectDialogStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.missingScopes).toEqual(["channel:manage:polls"]);
    expect(s.onReconnected).toBeNull();
  });

  it("stores the onReconnected callback when provided", () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({
      missingScopes: ["user:read:email"],
      onReconnected: cb,
    });
    expect(useReconnectDialogStore.getState().onReconnected).toBe(cb);
  });
});

describe("reconnect-dialog-store close", () => {
  it("sets isOpen to false and clears the completed flow callback", () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({ missingScopes: [], onReconnected: cb });
    useReconnectDialogStore.getState().close();
    expect(useReconnectDialogStore.getState().isOpen).toBe(false);
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });
});

describe("reconnect-dialog-store fireReconnected", () => {
  it("invokes the callback exactly once and nulls it after success", async () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });
    await useReconnectDialogStore.getState().fireReconnected();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });

  it("is a no-op when no callback is set", async () => {
    useReconnectDialogStore.getState().open({ missingScopes: [] });
    await useReconnectDialogStore.getState().fireReconnected();
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });

  it("does not fire the callback twice on repeated calls after success", async () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });
    await useReconnectDialogStore.getState().fireReconnected();
    await useReconnectDialogStore.getState().fireReconnected();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // Guards: a failed authority/history refresh must remain retryable from the same dialog.
  it("preserves a failed callback so Retry can rerun it and clears it after success", async () => {
    const cb = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("authority still unavailable"))
      .mockResolvedValueOnce();
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });

    await expect(useReconnectDialogStore.getState().fireReconnected()).rejects.toThrow(
      "authority still unavailable"
    );
    expect(useReconnectDialogStore.getState().onReconnected).toBe(cb);

    await expect(useReconnectDialogStore.getState().fireReconnected()).resolves.toBeUndefined();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });
});
