import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";

import { installElectronAPIMock } from "../../../../test-utils";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubEnv("VITE_TWITCH_CLIENT_ID", "configured-client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Guards: Twitch user popout profile fetches must pair the bearer token with the configured OAuth Client-Id, not an anonymous public Client-Id.
describe("useUserProfile", () => {
  it("fetches Twitch profile data with a valid token and configured Client-Id", async () => {
    const api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(async () => "valid-token");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "19789903",
              login: "streamfusiondev",
              display_name: "StreamFusionDev",
              profile_image_url: "https://static-cdn.jtvnw.net/jtv_user_pictures/me.png",
              created_at: "2011-06-06T00:00:00Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ broadcaster_id: "42", followed_at: "2026-01-01T00:00:00Z" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ data: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useUserProfile("19789903", "twitch", "42", "streamfusiondev", "channel"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.profile?.displayName).toBe("StreamFusionDev"));

    expect(fetchMock).toHaveBeenCalledWith("https://api.twitch.tv/helix/users?id=19789903", {
      headers: {
        Authorization: "Bearer valid-token",
        "Client-Id": "configured-client-id",
      },
    });
  });
});
