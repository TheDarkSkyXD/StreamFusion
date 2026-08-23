import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelModLogFeed } from "@/pages/Mod/channel/ChannelModLogFeed";
import { installElectronAPIMock, renderWithProviders, screen, waitFor } from "../../../test-utils";

const renderFeed = (channelId: string, refreshCounter?: number) => (
  <ChannelModLogFeed
    platform="twitch"
    channelId={channelId}
    channelSlug="somebody"
    refreshCounter={refreshCounter}
  />
);

describe("ChannelModLogFeed", () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it("renders the empty state when mod_log returns nothing", async () => {
    const api = installElectronAPIMock();
    api.modLog.query = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));
    renderWithProviders(renderFeed("222"));
    await waitFor(() => expect(screen.getByText(/no mod-log entries/i)).toBeInTheDocument());
  });

  it("renders rows returned by mod_log query", async () => {
    const api = installElectronAPIMock();
    const now = Date.now();
    api.modLog.query = vi.fn<typeof api.modLog.query>(async () => ({
      state: "ready" as const,
      coverage: "complete" as const,
      entries: [
        {
          id: 1,
          platform: "twitch" as const,
          channelId: "222",
          channelSlug: "somebody",
          action: "ban",
          targetUserId: "u9",
          targetUsername: "troll",
          moderatorUserId: "m1",
          moderatorUsername: "mod1",
          durationSeconds: null,
          reason: "spam",
          provenance: "twitch-eventsub" as const,
          providerEventId: "event-1",
          occurredAt: now,
          observedAt: now,
          createdAt: now,
        },
      ],
    }));
    renderWithProviders(renderFeed("222"));
    await waitFor(() => expect(screen.getByTestId("modlog-row")).toBeInTheDocument());
    expect(screen.getByTestId("modlog-target-username").textContent).toBe("troll");
  });

  it("forwards channelId to the modLog query", async () => {
    const api = installElectronAPIMock();
    const querySpy = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));
    api.modLog.query = querySpy;
    renderWithProviders(renderFeed("abc123"));
    await waitFor(() => expect(querySpy).toHaveBeenCalled());
    expect(querySpy.mock.calls[0][0]).toMatchObject({
      platform: "twitch",
      channelId: "abc123",
      channelSlug: "somebody",
    });
  });

  it("re-queries when refreshCounter changes", async () => {
    const api = installElectronAPIMock();
    const querySpy = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));
    api.modLog.query = querySpy;
    const { rerender } = renderWithProviders(renderFeed("x", 0));
    await waitFor(() => expect(querySpy).toHaveBeenCalledTimes(1));
    rerender(renderFeed("x", 1));
    await waitFor(() => expect(querySpy).toHaveBeenCalledTimes(2));
  });
});
