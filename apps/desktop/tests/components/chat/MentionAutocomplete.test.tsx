import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MentionAutocomplete } from "@/features/chat/components/chat/MentionAutocomplete";
import type { ChatMessage } from "@shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

function makeMessage(
  username: string,
  displayName: string,
  color = "#fff",
  channel = "test"
): ChatMessage {
  return {
    id: `${username}-${Math.random()}`,
    platform: "twitch",
    type: "message",
    channel,
    userId: username,
    username,
    displayName,
    color,
    badges: [],
    content: [{ type: "text", content: "hello" }],
    rawContent: "hello",
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function resetChatStore(): void {
  useChatStore.setState({ messagesByChannel: {}, usersByChannel: {} });
}

// Guards: mention suggestions show complete long usernames by wrapping instead of truncating.
// Guards: mention suggestions show the first page of users, then scroll-load additional known users instead of hard-capping at eight.
// Guards: Kick mention suggestions render avatar images immediately for bare "@" input; users should not need to type a query letter before avatars appear.
describe("MentionAutocomplete", () => {
  beforeEach(resetChatStore);
  afterEach(resetChatStore);

  it("renders nothing when inactive", () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue=""
        cursorPosition={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={false}
        platform="twitch"
        channel="test"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when input has no @", () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue="hello"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="test"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("registers keydown listener once across selectedIndex changes", () => {
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "test")]: [
          makeMessage("alice", "Alice"),
          makeMessage("alex", "Alex"),
          makeMessage("andre", "Andre"),
        ],
      },
    });

    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const props = {
      inputValue: "@a",
      cursorPosition: 2,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      isActive: true,
      platform: "twitch" as const,
      channel: "test",
    };

    const { rerender } = render(<MentionAutocomplete {...props} />);

    const initialKeydowns = addSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(initialKeydowns).toBe(1);

    // Drive selectedIndex up and down. With the latest-ref pattern, this
    // should not re-register the listener.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });

    rerender(<MentionAutocomplete {...props} />);

    const finalKeydowns = addSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(finalKeydowns).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("removes listener when isActive flips to false", () => {
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "test")]: [makeMessage("alice", "Alice")],
      },
    });

    const removeSpy = vi.spyOn(document, "removeEventListener");
    const initialRemoveCount = removeSpy.mock.calls.filter((c) => c[0] === "keydown").length;

    const props = {
      inputValue: "@a",
      cursorPosition: 2,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      isActive: true,
      platform: "twitch" as const,
      channel: "test",
    };

    const { rerender } = render(<MentionAutocomplete {...props} />);
    rerender(<MentionAutocomplete {...props} isActive={false} />);

    const removedKeydowns = removeSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(removedKeydowns).toBeGreaterThan(initialRemoveCount);

    removeSpy.mockRestore();
  });

  it("builds suggestions from the active channel bucket only", () => {
    const channelKey = buildChannelKey("twitch", "alpha");
    useChatStore.setState({
      messagesByChannel: {
        [channelKey]: [makeMessage("alice", "Alice", "#fff", "alpha")],
        [buildChannelKey("twitch", "bravo")]: [makeMessage("bravo", "Bravo", "#fff", "bravo")],
      },
    });

    const { getByText, queryByText } = render(
      <MentionAutocomplete
        inputValue="@a"
        cursorPosition={2}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="alpha"
      />
    );

    expect(getByText("Alice")).toBeInTheDocument();
    expect(queryByText("Bravo")).toBeNull();
  });

  it("wraps long usernames without truncation", () => {
    const longUsername = "averyveryveryveryveryverylongusernamewithoutnaturalbreaks";
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "test")]: [
          makeMessage(longUsername, "Display Name With A Very Long Label"),
        ],
      },
    });

    const { getByRole, getByText } = render(
      <MentionAutocomplete
        inputValue="@avery"
        cursorPosition={6}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="test"
      />
    );

    const listbox = getByRole("listbox");
    expect(listbox).toHaveClass("max-w-none");
    expect(listbox).not.toHaveClass("max-w-xs");

    const suggestionList = listbox.querySelector(".overflow-visible");
    expect(suggestionList).not.toBeNull();
    expect(suggestionList).not.toHaveClass("max-h-48");
    expect(suggestionList).not.toHaveClass("overflow-y-auto");

    const displayName = getByText("Display Name With A Very Long Label");
    expect(displayName).toHaveClass("break-words");
    expect(displayName).not.toHaveClass("truncate");

    const username = getByText(`@${longUsername}`);
    expect(username).toHaveClass("break-words");
    expect(username).not.toHaveClass("truncate");
  });

  it("adds a scrollbar and loads more known users when matches exceed the first page", () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      makeMessage(`user${index}`, `User ${index}`)
    );
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "test")]: messages,
      },
    });

    const { getByRole, getByText, queryByText } = render(
      <MentionAutocomplete
        inputValue="@user"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="test"
      />
    );

    const listbox = getByRole("listbox");
    const suggestionList = listbox.querySelector(".overflow-y-auto");
    expect(suggestionList).not.toBeNull();
    expect(suggestionList).toHaveClass("max-h-64");

    expect(getByText("User 11")).toBeInTheDocument();
    expect(queryByText("User 3")).toBeNull();

    Object.defineProperties(suggestionList, {
      scrollHeight: { configurable: true, value: 240 },
      clientHeight: { configurable: true, value: 120 },
      scrollTop: { configurable: true, value: 120 },
    });
    fireEvent.scroll(suggestionList!);

    expect(getByText("User 3")).toBeInTheDocument();
  });

  it("renders avatar images returned by mention enrichment", async () => {
    const enrichMentionUsers = vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          userId: "user8",
          username: "user8",
          displayName: "User 8",
          avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/user8-profile_image.png",
        },
      ],
    });
    const originalElectronAPI = window.electronAPI;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        ...originalElectronAPI,
        chat: {
          ...originalElectronAPI?.chat,
          enrichMentionUsers,
        },
      },
    });

    const messages = Array.from({ length: 9 }, (_, index) =>
      makeMessage(`user${index}`, `User ${index}`)
    );
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "test")]: messages,
      },
    });

    const { getByAltText } = render(
      <MentionAutocomplete
        inputValue="@user"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="test"
      />
    );

    await waitFor(() => {
      expect(enrichMentionUsers).toHaveBeenCalledWith({
        platform: "twitch",
        channel: "test",
        users: expect.arrayContaining([{ userId: "user8", username: "user8" }]),
      });
    });
    expect(enrichMentionUsers.mock.calls[0][0].users).toHaveLength(8);
    expect(enrichMentionUsers.mock.calls[0][0].users).not.toContainEqual({
      userId: "user0",
      username: "user0",
    });

    await waitFor(() => {
      const src = getByAltText("User 8").getAttribute("src") ?? "";
      expect(src.startsWith("twitch-image://image?u=")).toBe(true);
      const encoded = new URL(src).searchParams.get("u") ?? "";
      expect(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))).toBe(
        "https://static-cdn.jtvnw.net/jtv_user_pictures/user8-profile_image.png"
      );
    });

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: originalElectronAPI,
    });
  });

  it('renders Kick default avatar images immediately for bare "@" suggestions', async () => {
    const enrichMentionUsers = vi.fn(
      () =>
        new Promise<{
          success: boolean;
          data: Array<{
            userId: string;
            username: string;
            displayName: string;
            avatarUrl?: string;
          }>;
        }>(() => {
          // Keep pending so this assertion proves the first paint has an avatar image.
        })
    );
    const originalElectronAPI = window.electronAPI;
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        ...originalElectronAPI,
        chat: {
          ...originalElectronAPI?.chat,
          enrichMentionUsers,
        },
      },
    });

    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("kick", "test")]: [makeMessage("ashtrqqy", "Ashtrqqy")],
      },
    });

    const { getByAltText } = render(
      <MentionAutocomplete
        inputValue="@"
        cursorPosition={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="kick"
        channel="test"
      />
    );

    expect(getByAltText("Ashtrqqy")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml,/)
    );
    await waitFor(() => {
      expect(enrichMentionUsers).toHaveBeenCalledWith({
        platform: "kick",
        channel: "test",
        users: [{ userId: "ashtrqqy", username: "ashtrqqy" }],
      });
    });

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: originalElectronAPI,
    });
  });
});
