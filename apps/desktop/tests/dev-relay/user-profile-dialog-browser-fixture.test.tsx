import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPopout } from "@/components/chat/mod/UserPopout/UserPopout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBrowserElectronApi } from "@/dev-relay/browser-electron-api";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

function renderFixture(search: string) {
  const openingMessage: ChatMessage = {
    id: "browser-fixture-message",
    platform: "twitch",
    type: "message",
    channel: "streamer",
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    color: "#c084fc",
    badges: Array.from({ length: 6 }, (_, index) => ({
      setId: `fixture-${index}`,
      version: "1",
      imageUrl: `https://example.com/fixture-${index}.png`,
      title: `Fixture badge ${index}`,
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
  const relayCall = vi.fn(async (path: readonly string[]) => {
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
      default:
        throw new Error(`Unexpected relay path: ${path.join(".")}`);
    }
  });
  window.electronAPI = createBrowserElectronApi(
    { call: relayCall, subscribe: () => () => undefined },
    search
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
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
          open
          onOpenChange={() => undefined}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return relayCall;
}

afterEach(() => {
  useChatStore.setState({ messagesByChannel: {} });
  delete window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
  vi.restoreAllMocks();
});

describe("browser user-profile fixture", () => {
  it("renders real-reader responses relayed by the normal browser URL", async () => {
    const relayCall = renderFixture("");

    expect(await screen.findByRole("heading", { name: "Alice" })).toBeInTheDocument();
    expect(await screen.findByText("Jun 6, 2011")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open Alice on Twitch" })).toBeInTheDocument();
    expect(relayCall).toHaveBeenCalledWith(
      ["userProfiles", "getTwitchIdentity"],
      [{ userId: "u1", username: "alice" }]
    );
  });

  it("renders unavailable fixture actions without calling the relay", async () => {
    const relayCall = renderFixture("?userProfileFixture=unavailable");

    const accountRetry = (
      await screen.findAllByRole("button", { name: "Couldn’t verify · Retry" })
    )[0];
    const channelRetry = await screen.findByRole("button", { name: "Channel unavailable · Retry" });
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
    renderFixture("");

    expect(await screen.findByRole("heading", { name: "Recent in this chat" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Kappa emote details" })).toBeInTheDocument();
    expect(
      screen
        .getByTestId("user-profile-badges")
        .querySelectorAll('[role="img"][aria-label^="Fixture badge "]')
    ).toHaveLength(6);
    expect(screen.getByTestId("user-popout-selected-footer")).toHaveAttribute(
      "data-selected-message-id",
      "browser-fixture-message"
    );
  });
});
