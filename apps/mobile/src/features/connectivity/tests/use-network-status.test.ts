// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NetworkRead } from "../capabilities/connectivity-session";
import { useNetworkStatus } from "../components/use-network-status";

afterEach(() => vi.useRealTimers());

describe("useNetworkStatus", () => {
  it("shows online while disabled and resumes polling when enabled", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    const readNetwork = vi
      .fn<() => Promise<NetworkRead>>()
      .mockResolvedValue("offline");
    let status = "";
    const container = document.createElement("div");
    const root = createRoot(container);
    function Harness({ enabled }: { readonly enabled: boolean }) {
      status = useNetworkStatus({ enabled, readNetwork }).status;
      return null;
    }

    try {
      await act(async () =>
        root.render(createElement(Harness, { enabled: false })),
      );
      expect(status).toBe("online");
      expect(readNetwork).not.toHaveBeenCalled();

      await act(async () =>
        root.render(createElement(Harness, { enabled: true })),
      );
      expect(status).toBe("offline");
      expect(readNetwork).toHaveBeenCalledOnce();

      await act(async () =>
        root.render(createElement(Harness, { enabled: false })),
      );
      expect(status).toBe("online");
      expect(vi.getTimerCount()).toBe(0);

      readNetwork.mockResolvedValue("online");
      await act(async () =>
        root.render(createElement(Harness, { enabled: true })),
      );
      expect(status).toBe("online");
      expect(readNetwork).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      await act(async () => root.unmount());
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
