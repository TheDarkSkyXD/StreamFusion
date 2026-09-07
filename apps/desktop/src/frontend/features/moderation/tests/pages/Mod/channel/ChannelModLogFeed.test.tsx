import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChannelModLogFeed } from "@/features/moderation/components/screens/Mod/channel/ChannelModLogFeed";
import { installElectronAPIMock, renderWithProviders, screen, waitFor } from "../../../../../../../../tests/test-utils";

const renderFeed = (
  channelId: string,
  refreshCounter?: number,
  presentation?: "standalone" | "embedded"
) => (
  <ChannelModLogFeed
    platform="twitch"
    channelId={channelId}
    channelSlug="somebody"
    refreshCounter={refreshCounter}
    presentation={presentation}
  />
);

// Guards: action categories are sent to the paginated IPC query, rather than filtering only its first page.
// Guards: selecting no action category deliberately requests no actions instead of widening back to all actions.
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

  it("keeps filters and data states when embedded without rendering duplicate panel chrome", async () => {
    const api = installElectronAPIMock();
    api.modLog.query = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));

    renderWithProviders(renderFeed("222", undefined, "embedded"));

    await waitFor(() => expect(screen.getByText(/no mod-log entries/i)).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /mod log/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filters \(14 selected\)/i })).toBeInTheDocument();
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

  it("queries selected action categories before pagination and supports an intentional empty selection", async () => {
    const user = userEvent.setup();
    const api = installElectronAPIMock();
    const querySpy = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));
    api.modLog.query = querySpy;
    renderWithProviders(renderFeed("222"));

    await waitFor(() => expect(querySpy).toHaveBeenCalled());
    expect(querySpy.mock.calls.at(-1)?.[0]).toMatchObject({ actions: undefined, limit: 50 });

    await user.click(screen.getByRole("button", { name: /filters \(14 selected\)/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Filter Mod Actions by Type")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: "All" })).toHaveAttribute(
      "data-state",
      "checked"
    );
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Bans and Unbans" }));

    await waitFor(() => {
      const filters = querySpy.mock.calls.at(-1)?.[0];
      expect(filters?.actions).toContain("delete");
      expect(filters?.actions).not.toContain("ban");
      expect(filters?.actions).not.toContain("unban");
    });

    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "All" }));
    await waitFor(() => expect(querySpy.mock.calls.at(-1)?.[0]).toMatchObject({ actions: [] }));
  });

  it("keeps the moderator search accessible inside the action filter menu", async () => {
    const user = userEvent.setup();
    const api = installElectronAPIMock();
    const querySpy = vi.fn<typeof api.modLog.query>(async () => ({
      state: "verified-empty" as const,
      entries: [],
      coverage: "complete" as const,
    }));
    api.modLog.query = querySpy;
    renderWithProviders(renderFeed("222"));

    await user.click(screen.getByRole("button", { name: /filters \(14 selected\)/i }));
    await user.type(screen.getByLabelText(/moderator username/i), "mod_anna");

    await waitFor(() =>
      expect(querySpy.mock.calls.at(-1)?.[0]).toMatchObject({ moderatorUsername: "mod_anna" })
    );
  });
});
