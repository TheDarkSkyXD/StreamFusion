import { render, screen } from "@testing-library/react";
import {
  MutationObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { createNetworkStatusStore } from "@/hooks/network-status-store";

const useBrowseSnapshotBootstrap = vi.hoisted(() => vi.fn());

vi.mock("@/features/discovery/data/queries/browse-snapshot-bootstrap", () => ({
  useBrowseSnapshotBootstrap,
}));

import { QueryProvider, queryClient } from "@/providers/query-provider";
import { configureConfirmedConnectivity } from "@/providers/query-connectivity";

// Guards: the app-level query provider starts persisted Following hydration before routes render.
describe("QueryProvider", () => {
  it("starts persisted browse and following hydration alongside the route tree", () => {
    render(
      <QueryProvider>
        <div>route tree</div>
      </QueryProvider>
    );

    expect(screen.getByText("route tree")).toBeInTheDocument();
    expect(useBrowseSnapshotBootstrap).toHaveBeenCalledWith(queryClient);
  });

  it("refetches active queries only after confirmed internet recovery", async () => {
    const events = new EventTarget();
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ status: "offline" as const })
      .mockResolvedValue({ status: "online" as const });
    const store = createNetworkStatusStore({
      probe,
      eventTarget: events,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => "fresh");
    client.setQueryData(["active-on-recovery"], "cached");
    const observer = new QueryObserver(client, {
      queryKey: ["active-on-recovery"],
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribeObserver = observer.subscribe(() => undefined);

    configureConfirmedConnectivity(client, store);
    client.mount();

    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(onlineManager.isOnline()).toBe(false);
      expect(queryFn).not.toHaveBeenCalled();

      events.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
      expect(onlineManager.isOnline()).toBe(true);
    } finally {
      unsubscribeObserver();
      client.unmount();
      configureConfirmedConnectivity(queryClient);
      onlineManager.setOnline(true);
    }
  });

  it("does not queue or replay mutations when internet connectivity changes", async () => {
    const client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() });
    const mutationFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const observer = new MutationObserver(client, { mutationFn });
    onlineManager.setOnline(false);

    await expect(observer.mutate(undefined)).rejects.toThrow("offline");
    expect(mutationFn).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(true);
    await Promise.resolve();
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
