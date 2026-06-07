import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

function resetStore() {
  useReconnectDialogStore.setState({
    isOpen: false,
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
  it("sets isOpen to false", () => {
    useReconnectDialogStore.getState().open({ missingScopes: [] });
    useReconnectDialogStore.getState().close();
    expect(useReconnectDialogStore.getState().isOpen).toBe(false);
  });
});

describe("reconnect-dialog-store fireReconnected", () => {
  it("invokes the callback exactly once and nulls it", () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });
    useReconnectDialogStore.getState().fireReconnected();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });

  it("is a no-op when no callback is set", () => {
    useReconnectDialogStore.getState().open({ missingScopes: [] });
    useReconnectDialogStore.getState().fireReconnected();
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });

  it("does not fire the callback twice on repeated calls", () => {
    const cb = vi.fn();
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });
    useReconnectDialogStore.getState().fireReconnected();
    useReconnectDialogStore.getState().fireReconnected();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("nulls the callback before invoking to prevent re-entrant double-fire", () => {
    let callbackSawNull = false;
    const cb = () => {
      callbackSawNull = useReconnectDialogStore.getState().onReconnected === null;
    };
    useReconnectDialogStore.getState().open({
      missingScopes: [],
      onReconnected: cb,
    });
    useReconnectDialogStore.getState().fireReconnected();
    expect(callbackSawNull).toBe(true);
  });
});
