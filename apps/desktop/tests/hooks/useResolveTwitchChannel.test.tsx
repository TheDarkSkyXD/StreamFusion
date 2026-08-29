import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

import { useResolveTwitchChannel } from "@/features/moderation/data/useResolveTwitchChannel";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useResolveTwitchChannel", () => {
  let api: ReturnType<typeof installElectronAPIMock>;

  beforeEach(() => {
    vi.stubEnv("VITE_TWITCH_CLIENT_ID", "cid");
    api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: "tok" }));
  });

  it("returns null for falsy input", async () => {
    const { result } = renderHook(() => useResolveTwitchChannel(null), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("resolves login to id on 200 OK", async () => {
    api.twitch.execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: "99", login: "ninja", displayName: "Ninja" },
    });
    const { result } = renderHook(() => useResolveTwitchChannel("ninja"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      expect(result.current).toEqual({
        id: "99",
        login: "ninja",
        displayName: "Ninja",
      })
    );
    expect(api.twitch.execute).toHaveBeenCalledWith({
      operation: "resolve-channel",
      login: "ninja",
    });
  });

  it("returns null on 404", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const { result } = renderHook(() => useResolveTwitchChannel("ghost"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });

  it("returns null on 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const { result } = renderHook(() => useResolveTwitchChannel("locked"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });

  it("returns null on empty Helix data array", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
      );
    const { result } = renderHook(() => useResolveTwitchChannel("nope"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });
});
