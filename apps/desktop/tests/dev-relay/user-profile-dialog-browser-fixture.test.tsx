import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPopout } from "@/components/chat/mod/UserPopout/UserPopout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBrowserElectronApi } from "@/dev-relay/browser-electron-api";
import { applyModerationBrowserFixture } from "@/dev-relay/moderation-browser-fixtures";
import type { ChatMessage } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

let fixtureClient: QueryClient | undefined;

async function renderFixture(search: string) {
  window.history.replaceState({}, "", search || "/");
  applyModerationBrowserFixture(search);
  const actionState = new URLSearchParams(search).get("actionState");
  const openingMessage: ChatMessage = {
    id: "selected-chat-message",
    platform: "twitch",
    type: "message",
    channel: "streamer",
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    color: "#c084fc",
    badges: Array.from({ length: 6 }, (_, index) => ({
      setId: `chat-badge-${index}`,
      version: "1",
      imageUrl: `https://example.com/chat-badge-${index}.png`,
      title: `Chat badge ${index}`,
    })),
    content: [
      { type: "text", content: "Browser parity " },
      {
        type: "emote",
        id: "25",
        name: "Kappa",
        url: "https://example.com/kappa.png",
      },
    ],
    rawContent: "Browser parity Kappa",
    timestamp: new Date("2026-07-30T00:00:00Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
  useChatStore.setState({
    messagesByChannel: {
      [buildChannelKey("twitch", "streamer")]: [openingMessage],
    },
  });
  const relayCall = vi.fn(async (path: readonly string[], _args: readonly unknown[]) => {
    switch (path.join(".")) {
      case "userProfiles.getTwitchIdentity":
        return {
          state: "known",
          source: "first-party-fallback",
          value: {
            userId: "u1",
            username: "alice",
            displayName: "Alice",
            avatarUrl: "",
          },
        };
      case "userProfiles.getTwitchAccountCreated":
        return {
          state: "known",
          source: "first-party-fallback",
          value: "2011-06-06T00:00:00Z",
        };
      case "userProfiles.getTwitchFollow":
        return {
          state: "known",
          source: "official",
          value: "2020-01-15T00:00:00Z",
        };
      case "userProfiles.resolveTwitchChannel":
        return {
          state: "known",
          source: "first-party-fallback",
          value: { id: "c1", username: "alice", displayName: "Alice" },
        };
      case "modLog.query":
        return {
          state: "ready",
          coverage: "complete",
          entries: [
            {
              id: 1,
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
              action: "timeout",
              targetUserId: "u1",
              targetUsername: "Alice",
              moderatorUserId: "real-moderator",
              moderatorUsername: "RealModerator",
              durationSeconds: 600,
              reason: "Spam",
              provenance: "twitch-eventsub",
              providerEventId: "event-1",
              occurredAt: Date.UTC(2026, 6, 30, 12),
              observedAt: Date.UTC(2026, 6, 30, 12),
              createdAt: Date.UTC(2026, 6, 30, 12),
            },
          ],
        };
      case "moderation.createTimeoutSnapshot":
        return {
          state: "available",
          snapshotId: "normal-relay-timeout-snapshot",
          verifiedAt: Date.UTC(2026, 6, 30, 12),
          actorRole: "moderator",
          policy: {
            durationUnit: "seconds",
            minDuration: 1,
            maxDuration: 1_209_600,
            supportsReason: true,
            maxReasonLength: 500,
          },
        };
      default:
        throw new Error(`Unexpected relay path: ${path.join(".")}`);
    }
  });
  window.electronAPI = createBrowserElectronApi(
    {
      call: (path, args) =>
        path.join(".") === "connectivity.check"
          ? Promise.resolve({ status: "online" })
          : relayCall(path, args),
      subscribe: () => () => undefined,
    },
    search
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  fixtureClient = client;
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <UserPopout
          userId="u1"
          username="alice"
          platform="twitch"
          channelId="c1"
          channelSlug="streamer"
          openingMessage={openingMessage}
          badgeCatalog={{
            state: "ready",
            sourceLabel: "Twitch · Live chat",
            retry: vi.fn(),
          }}
          publicActions={{
            replyEligibility:
              actionState === "guest"
                ? null
                : actionState === "ineligible"
                  ? { state: "ineligible", reason: "Followers-only chat is enabled" }
                  : { state: "eligible" },
            onReply: vi.fn(),
            onViewChannel: vi.fn(),
          }}
          open
          onOpenChange={() => undefined}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );

  if (new URLSearchParams(search).get("userProfileFixture") === "unavailable") {
    await screen.findByRole("button", { name: /Profile unavailable.*Retry/ });
  } else {
    await screen.findByRole("heading", { name: "Alice" });
    await screen.findByText("Jun 6, 2011");
    await screen.findByText("Jan 15, 2020");
    await screen.findByRole("button", { name: "Open Alice on Twitch" });
  }

  return relayCall;
}

afterEach(() => {
  act(() => {
    cleanup();
    fixtureClient?.clear();
    fixtureClient = undefined;
    window.history.replaceState({}, "", "/");
    useChatStore.setState({ messagesByChannel: {} });
    useAuthStore.setState({ twitchUser: null, twitchConnected: false, isGuest: true });
    useDevModOverrideStore.getState().reset();
    delete window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
    vi.restoreAllMocks();
  });
});

describe("browser user-profile fixture", () => {
  it("renders real-reader responses relayed by the normal browser URL", async () => {
    const relayCall = await renderFixture("");

    expect(await screen.findByRole("heading", { name: "Alice" })).toBeInTheDocument();
    expect(await screen.findByText("Jun 6, 2011")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open Alice on Twitch" })).toBeInTheDocument();
    expect(relayCall).toHaveBeenCalledWith(
      ["userProfiles", "getTwitchIdentity"],
      [{ userId: "u1", username: "alice" }]
    );
  });

  it("renders unavailable fixture actions without calling the relay", async () => {
    const relayCall = await renderFixture("?userProfileFixture=unavailable");

    const accountRetry = (
      await screen.findAllByRole("button", { name: "Couldn’t verify · Retry" })
    )[0];
    const channelRetry = await within(screen.getByTestId("user-popout-selected-footer")).findByRole(
      "button",
      { name: "Couldn’t verify · Retry" }
    );
    expect(screen.getByRole("button", { name: "View Channel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open alice on Twitch" })).toBeInTheDocument();

    fireEvent.click(accountRetry);
    fireEvent.click(channelRetry);

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Couldn’t verify · Retry" }).length
      ).toBeGreaterThan(0)
    );
    expect(relayCall).not.toHaveBeenCalled();
  });

  it("keeps rich recent chat and complete badges available in the browser fixture", async () => {
    await renderFixture("");

    expect(await screen.findByRole("heading", { name: "Recent in this chat" })).toBeInTheDocument();
    expect(within(screen.getByTestId("user-popout-recent-messages")).getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Kappa emote details" })).toBeInTheDocument();
    expect(
      screen
        .getByTestId("user-profile-badges")
        .querySelectorAll('[role="img"][aria-label^="Chat badge "]')
    ).toHaveLength(6);
    expect(screen.getByTestId("user-popout-selected-footer")).toHaveAttribute(
      "data-selected-message-id",
      "selected-chat-message"
    );
  });

  it.each([
    ["", "enabled"],
    ["?actionState=ineligible", "disabled"],
    ["?actionState=guest", "hidden"],
  ] as const)("renders the %s Reply fixture state as %s", async (search, expected) => {
    await renderFixture(search);

    await screen.findByRole("heading", { name: "Alice" });
    const reply = screen.queryByRole("button", { name: "Reply" });
    if (expected === "hidden") {
      expect(reply).toBeNull();
    } else if (expected === "disabled") {
      expect(reply).toBeDisabled();
      expect(reply).toHaveAttribute("title", "Followers-only chat is enabled");
    } else {
      expect(reply).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "Copy message" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Translate · Coming Soon" })).toBeDisabled();
  });

  it("renders real selected-user history returned by the normal relay", async () => {
    const relayCall = await renderFixture("?moderationFixture=history");

    expect(await screen.findByRole("heading", { name: "Moderation history" })).toBeInTheDocument();
    expect(
      (await screen.findByTestId("user-mod-history-list")).querySelectorAll("li")
    ).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Timeout user" })).toBeInTheDocument();
    expect(screen.getByText("Platform actions available to StreamFusion")).toBeInTheDocument();
    expect(relayCall).toHaveBeenCalledWith(
      ["modLog", "query"],
      [
        expect.objectContaining({
          platform: "twitch",
          channelId: "c1",
          channelSlug: "streamer",
          targetUserId: "u1",
        }),
      ]
    );
    expect(relayCall).toHaveBeenCalledWith(
      ["moderation", "createTimeoutSnapshot"],
      [
        expect.objectContaining({
          action: "timeout",
          channelId: "c1",
          channelSlug: "streamer",
          targetUserId: "u1",
        }),
      ]
    );
  });

  it("keeps reconnect fixture authorization and token checks inside the browser client", async () => {
    const relayCall = await renderFixture("?moderationFixture=reconnect");

    expect(await screen.findByTestId("moderation-reconnect-required")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Moderation history" })).toBeNull();
    expect(
      relayCall.mock.calls.some(([path]) =>
        ["auth.tokenStatus", "auth.openTwitchLogin", "modLog.query"].includes(path.join("."))
      )
    ).toBe(false);
  });
});
