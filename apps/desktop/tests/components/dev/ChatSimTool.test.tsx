import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSimTool } from "@/components/dev/ChatSimTool";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

const serviceMocks = vi.hoisted(() => ({
  kickEmit: vi.fn(),
  twitchEmit: vi.fn(),
  simulateRaid: vi.fn(),
}));

vi.mock("@backend/services/chat/raid-handoff-source", () => ({
  simulateRaidHandoffForDev: (...args: unknown[]) => serviceMocks.simulateRaid(...args),
}));

vi.mock("@backend/services/chat/kick-chat", () => ({
  kickChatService: {
    emit: (...args: unknown[]) => serviceMocks.kickEmit(...args),
  },
  kickPinToNormalized: (pin: { message: { id: string; content: string; created_at: string } }) => ({
    platform: "kick",
    messageId: pin.message.id,
    pinRecordId: pin.message.id,
    author: { username: "debug", displayName: "debug", color: "#ffffff", badges: [] },
    content: [{ type: "text", content: pin.message.content }],
    pinnedBy: null,
    pinnedAt: pin.message.created_at,
    sentAt: pin.message.created_at,
    expiresAt: null,
  }),
}));

vi.mock("@backend/services/chat/twitch-chat", () => ({
  twitchChatService: {
    emit: (...args: unknown[]) => serviceMocks.twitchEmit(...args),
  },
}));

function resetChatStore() {
  const store = useChatStore.getState();
  for (const key of Object.keys(store.messagesByChannel)) {
    store.clearMessages(key);
  }
  store.updateConnectionStatus({
    platform: "twitch",
    state: "connected",
    channels: ["ninja"],
    isAuthenticated: true,
  });
  store.updateConnectionStatus({
    platform: "kick",
    state: "disconnected",
    channels: [],
    isAuthenticated: false,
  });
  useAuthStore.setState({ preferences: DEFAULT_USER_PREFERENCES });
}

// Guards: chat simulator buttons inject into the mounted chat channel, not a private debug bucket.
// Guards: chat simulator subscription notices use event-highlight rows with the real actor, not generic System rows.
// Guards: multi-gift simulation emits the Twitch-style summary plus one recipient gift notice per gifted sub.
// Guards: every chat simulator button has a hover tooltip so the debug console controls are discoverable.
// Guards: Twitch-only slash-me action is hidden on Kick because Kick chat does not support /me messages.
// Guards: moderation simulator controls create retained deleted rows in the selected Twitch/Kick channel and preview both highlight styles.
// Guards: outgoing raid controls remain separate from the incoming raid notice and drive the normalized production ingestion seam.
describe("ChatSimTool", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    resetChatStore();
    serviceMocks.kickEmit.mockReset();
    serviceMocks.twitchEmit.mockReset();
    serviceMocks.simulateRaid.mockReset();
  });

  it("offers separate deterministic outgoing raid controls", () => {
    window.history.replaceState(null, "", "/#/stream/kick/xqc");
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "Twitch offer" }));
    expect(serviceMocks.simulateRaid).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "offer", platform: "twitch", sourceChannelSlug: "ninja" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Twitch go" }));
    expect(serviceMocks.simulateRaid).toHaveBeenCalledWith({
      phase: "go",
      platform: "twitch",
      sourceChannelSlug: "ninja",
    });

    fireEvent.click(screen.getByRole("button", { name: "Kick short deadline" }));
    expect(serviceMocks.simulateRaid).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "offer",
        platform: "kick",
        sourceChannelSlug: "xqc",
        kickDeadlineMs: 3_000,
      })
    );
    expect(screen.getByRole("button", { name: "raid 1.2k" })).toBeInTheDocument();
  });

  it("injects debug messages into the connected Twitch chat channel", () => {
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "random" }));

    const messages = useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
        channel: "ninja",
        type: "message",
      })
    );
  });

  it("injects subscription notices as event highlights without a System sender", () => {
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "sub" }));

    const messages = useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
        channel: "ninja",
        type: "system",
        highlightKind: "subscription",
      })
    );
    expect(messages[0].username).not.toBe("System");
    expect(messages[0].displayName).not.toBe("System");
    expect(messages[0].rawContent).toMatch(/ subscribed with Prime\.$/);
  });

  it("injects a multi-gift summary followed by individual recipient gift notices", () => {
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "50 mystery gifts" }));

    const messages = useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")];
    expect(messages).toHaveLength(51);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
        channel: "ninja",
        type: "system",
        username: "alice",
        displayName: "Alice",
        highlightKind: "gifted-sub",
        rawContent: "Alice gifted 50 Tier 1 Subs to the channel!",
      })
    );

    const recipientNotices = messages.slice(1);
    expect(recipientNotices).toHaveLength(50);
    expect(recipientNotices[0]).toEqual(
      expect.objectContaining({
        type: "system",
        username: "alice",
        displayName: "Alice",
        highlightKind: "gifted-sub",
        rawContent: "Alice gifted a Tier 1 Sub to ecchatan21!",
      })
    );
    expect(recipientNotices[1].rawContent).toBe("Alice gifted a Tier 1 Sub to TorchOsrs!");
    expect(recipientNotices[49].rawContent).toBe("Alice gifted a Tier 1 Sub to GiftedViewer50!");
    expect(recipientNotices.every((message) => message.username !== "System")).toBe(true);
  });

  it("puts tooltip text on every simulator button", () => {
    render(<ChatSimTool />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("title", expect.stringMatching(/\S/));
    }
  });

  it("shows the /me action simulator only for Twitch", () => {
    render(<ChatSimTool />);

    expect(screen.getByRole("button", { name: "/me action" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kick" } });

    expect(screen.queryByRole("button", { name: "/me action" })).not.toBeInTheDocument();
  });

  it("injects retained deleted-message previews into the selected platform channel", () => {
    useChatStore.getState().updateConnectionStatus({
      platform: "kick",
      state: "connected",
      channels: ["adin"],
      isAuthenticated: true,
    });
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "deleted compact" }));

    let messages = useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
        isDeleted: true,
        rawContent: expect.stringContaining("deleted"),
        deletedByUsername: "ModeratorBot",
      })
    );
    expect(useAuthStore.getState().preferences?.chatDisplay.moderationHighlightStyle).toBe(
      "compact"
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "kick" } });

    fireEvent.click(screen.getByRole("button", { name: "deleted framed" }));

    messages = useChatStore.getState().messagesByChannel[buildChannelKey("kick", "adin")];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        platform: "kick",
        isDeleted: true,
        deletedByUsername: "ModeratorBot",
      })
    );
    expect(useAuthStore.getState().preferences?.chatDisplay.moderationHighlightStyle).toBe("cozy");
  });

  it("replaces old moderation controls with compact/framed deleted timeout and ban previews", () => {
    render(<ChatSimTool />);

    expect(screen.queryByRole("button", { name: "deleted msg" })).toBeNull();
    expect(screen.queryByRole("button", { name: "timeout delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "timeout 60s" })).toBeNull();
    expect(screen.queryByRole("button", { name: "timeout 10m" })).toBeNull();
    expect(screen.queryByRole("button", { name: "perma ban" })).toBeNull();
    expect(screen.getByRole("button", { name: "deleted compact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "deleted framed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "timeout compact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "timeout framed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ban compact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ban framed" })).toBeInTheDocument();
  });

  it("injects timeout and ban previews with retained rows and selected highlight style", () => {
    render(<ChatSimTool />);

    fireEvent.click(screen.getByRole("button", { name: "timeout framed" }));

    const messages =
      useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")] ?? [];
    expect(messages).toHaveLength(4);
    expect(messages.slice(0, 3)).toEqual([
      expect.objectContaining({ isDeleted: true, deletedByUsername: "ModeratorBot" }),
      expect.objectContaining({ isDeleted: true, deletedByUsername: "ModeratorBot" }),
      expect.objectContaining({ isDeleted: true, deletedByUsername: "ModeratorBot" }),
    ]);
    expect(messages[3]).toEqual(
      expect.objectContaining({
        type: "ban",
        banInfo: expect.objectContaining({
          bannedByUsername: "ModeratorBot",
          lastMessage: "timeout preview message 2",
          duration: 600,
        }),
      })
    );
    expect(useAuthStore.getState().preferences?.chatDisplay).toMatchObject({
      ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
      deletedMessageDisplay: "compact",
      moderationHighlightStyle: "cozy",
      showClearChat: true,
      showClearMsg: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "ban compact" }));

    const updatedMessages =
      useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "ninja")] ?? [];
    expect(updatedMessages.at(-1)).toEqual(
      expect.objectContaining({
        type: "ban",
        banInfo: expect.objectContaining({
          duration: undefined,
          lastMessage: "ban preview message 2",
        }),
      })
    );
    expect(useAuthStore.getState().preferences?.chatDisplay.moderationHighlightStyle).toBe(
      "compact"
    );
  });
});
