import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithProviders as render } from "../../../../test-utils";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

vi.mock("@/components/chat/mod/UserPopout/useUserProfile", () => ({
  useUserProfile: vi.fn(() => ({
    profile: null,
    loading: false,
    error: null,
    identity: {
      state: "known",
      source: "official",
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
      },
    },
    accountCreated: {
      state: "known",
      source: "official",
      value: "2020-01-01T00:00:00Z",
    },
    follow: { state: "negative", source: "official" },
    channel: { state: "unavailable", message: "Unavailable" },
    retryIdentity: vi.fn(),
    retryAccountCreated: vi.fn(),
    retryFollow: vi.fn(),
    retryChannel: vi.fn(),
  })),
}));
vi.mock("@/hooks/useModLog", () => ({
  useModLog: () => ({ entries: [], loading: false }),
}));

import {
  UserPopoutProvider,
  useOpenUserPopout,
} from "@/components/chat/mod/UserPopout/UserPopoutProvider";
import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";

const mockedUseUserProfile = vi.mocked(useUserProfile);

beforeEach(() => {
  useChatStore.setState({ messagesByChannel: {} });
  (globalThis as any).window.electronAPI = {
    openExternal: vi.fn(),
    auth: { getToken: vi.fn().mockResolvedValue(null) },
  };
});

function Opener({
  payload,
  label = "open",
}: {
  payload: Parameters<ReturnType<typeof useOpenUserPopout>>[0];
  label?: string;
}) {
  const open = useOpenUserPopout();
  return (
    <button type="button" onClick={() => open(payload)}>
      {label}
    </button>
  );
}

describe("UserPopoutProvider", () => {
  // Guards: selected-message actions close the dialog before replacing the composer draft.
  it("closes the dialog and forwards Copy message to chat after the dialog unmounts", async () => {
    const onCopyToChat = vi.fn();
    const openingMessage: ChatMessage = {
      id: "m1",
      platform: "twitch",
      type: "message",
      channel: "streamer",
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "copy this into chat" }],
      rawContent: "copy this into chat",
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [openingMessage],
      },
    });

    render(
      <TooltipProvider>
        <UserPopoutProvider
          publicActions={{
            replyEligibility: { state: "eligible" },
            onReply: vi.fn(),
            onCopyToChat,
            onViewChannel: vi.fn(),
          }}
        >
          <Opener
            payload={{
              userId: "u1",
              username: "alice",
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
              openingMessage,
            }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy message to chat" }));

    expect(screen.queryByTestId("user-popout")).toBeNull();
    await waitFor(() => expect(onCopyToChat).toHaveBeenCalledWith("copy this into chat"));
  });

  it("openUserPopout renders the popout for the requested user", () => {
    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Opener
            payload={{
              userId: "u1",
              username: "alice",
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
            }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );
    expect(screen.queryByTestId("user-popout")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("restores focus to the control that opened the dialog", async () => {
    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Opener
            label="Alice"
            payload={{
              userId: "u1",
              username: "alice",
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
            }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );
    const opener = screen.getByRole("button", { name: "Alice" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    await vi.waitFor(() => expect(opener).toHaveFocus());
  });

  it("restores focus to a virtualized chat fallback when the opener unmounts", async () => {
    function VirtualizedOpener() {
      const open = useOpenUserPopout();
      const [showOpener, setShowOpener] = useState(true);
      return (
        <>
          {showOpener ? (
            <button
              type="button"
              onClick={() => {
                open({
                  userId: "u1",
                  username: "alice",
                  platform: "twitch",
                  channelId: "c1",
                  channelSlug: "streamer",
                });
                setShowOpener(false);
              }}
            >
              Alice
            </button>
          ) : null}
          <div data-testid="chat-message-list" />
        </>
      );
    }

    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <VirtualizedOpener />
        </UserPopoutProvider>
      </TooltipProvider>
    );
    const opener = screen.getByRole("button", { name: "Alice" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

    await vi.waitFor(() => expect(screen.getByTestId("chat-message-list")).toHaveFocus());
    expect(screen.getByTestId("chat-message-list")).toHaveAttribute("tabindex", "-1");
  });

  it("calling openUserPopout again with a different user swaps the rendered content", () => {
    mockedUseUserProfile.mockImplementation((userId) => {
      const isBob = userId === "u2";
      return {
        profile: null,
        loading: false,
        error: null,
        identity: {
          state: "known",
          source: "official",
          value: {
            userId: isBob ? "u2" : "u1",
            username: isBob ? "bob" : "alice",
            displayName: isBob ? "Bob" : "Alice",
            avatarUrl: "",
          },
        },
        accountCreated: {
          state: "known",
          source: "official",
          value: isBob ? "2021-01-01T00:00:00Z" : "2020-01-01T00:00:00Z",
        },
        follow: { state: "negative", source: "official" },
        channel: { state: "unavailable", message: "Unavailable" },
        retryIdentity: vi.fn(),
        retryAccountCreated: vi.fn(),
        retryFollow: vi.fn(),
        retryChannel: vi.fn(),
      };
    });

    // Use a single trigger that switches its payload — Radix Dialog traps
    // focus while open, so two adjacent triggers aren't both reachable. The
    // assertion is that swapping which user is open re-renders the content.
    function Trigger() {
      const open = useOpenUserPopout();
      return (
        <div>
          <button
            type="button"
            data-testid="alice"
            onClick={() =>
              open({
                userId: "u1",
                username: "alice",
                platform: "twitch",
                channelId: "c1",
                channelSlug: "streamer",
              })
            }
          />
          <button
            type="button"
            data-testid="bob"
            onClick={() =>
              open({
                userId: "u2",
                username: "bob",
                platform: "twitch",
                channelId: "c1",
                channelSlug: "streamer",
              })
            }
          />
        </div>
      );
    }

    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Trigger />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    fireEvent.click(screen.getByTestId("alice"));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Trigger button stays in the DOM under the Dialog overlay even with
    // focus trapped — we click it by testId, not by accessible name.
    fireEvent.click(screen.getByTestId("bob"));
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("useOpenUserPopout outside a provider returns a callable no-op and console.debugs once", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    function Inner() {
      const open = useOpenUserPopout();
      return (
        <button
          type="button"
          onClick={() =>
            open({
              userId: "u1",
              username: "alice",
              platform: "twitch",
              channelId: "c1",
              channelSlug: "streamer",
            })
          }
        >
          fire
        </button>
      );
    }
    render(<Inner />);
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    // Two calls but only one debug emission.
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
