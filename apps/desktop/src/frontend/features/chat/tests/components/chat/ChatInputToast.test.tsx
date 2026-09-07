import { act, fireEvent, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/chat/adapters/browser/twitch-chat", () => ({
  twitchChatService: {
    setChannelLifecycle: vi.fn(),
    sendMessage: vi.fn(async () => true),
    sendAction: vi.fn(async () => true),
    sendReply: vi.fn(async () => true),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("@/features/discovery/components/hooks/queries/useChannels", () => ({
  useChannelByUsername: () => ({ data: undefined }),
}));

import { ChatInput } from "@/features/chat/components/chat/ChatInput";
import { loadTwitchChatModule } from "@/features/chat/composition/chat-service-loader";
import { twitchChatService } from "@/features/chat/adapters/browser/twitch-chat";
import { useFollowStore } from "@/features/discovery/components/state/follow-store";
import { useRoomStateStore } from "@/features/chat/components/state/room-state-store";
import { renderWithProviders as render } from "../../../../../../../tests/test-utils";

beforeAll(async () => {
  await loadTwitchChatModule();
});

// Guards: local follower-only chat restrictions retain the draft and never send it while the
// ChatInput listener remains compatible with the Twitch chat event contract.
describe("ChatInput follower-only restriction integration", () => {
  beforeEach(() => {
    useRoomStateStore.setState({ entries: {} });
    useFollowStore.setState({ localFollows: [], sourceByKey: new Map() });
  });

  it("blocks a follower-only attempt while preserving the draft and event subscription", async () => {
    useRoomStateStore.getState().updateRoomState("twitch", "12345", { followersOnly: 10 });
    const { unmount } = render(
      <ChatInput
        channel="ninja"
        platform="twitch"
        channelId="12345"
        isAuthenticated
        canSend
      />
    );
    const onMock = vi.mocked(twitchChatService.on);
    expect(onMock).toHaveBeenCalledWith("viewerSendRestriction", expect.any(Function));

    const editor = screen.getByRole("textbox", { name: /send a message/i });
    editor.textContent = "keep this draft";
    fireEvent.input(editor);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    });

    expect(screen.getByTestId("info-banner-primary")).toHaveTextContent("Followers Only Mode [10m]");
    expect(twitchChatService.sendMessage).not.toHaveBeenCalled();
    expect(editor).toHaveTextContent("keep this draft");

    const [event, listener] = onMock.mock.calls[0];
    unmount();
    expect(vi.mocked(twitchChatService.off)).toHaveBeenCalledWith(event, listener);
  });
});
