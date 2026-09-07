import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor } from "../../../../../../../../../tests/test-utils";

const mocks = vi.hoisted(() => ({
  channelQuery: vi.fn(),
  streamQuery: vi.fn(),
  playback: vi.fn(),
}));

vi.mock("@/features/discovery/components/hooks/queries/useChannels", () => ({
  useChannelByUsername: mocks.channelQuery,
}));
vi.mock("@/features/discovery/components/hooks/queries/useStreams", () => ({
  useStreamByChannel: mocks.streamQuery,
}));
vi.mock("@/features/playback/components/hooks/useStreamPlayback", () => ({
  useStreamPlayback: mocks.playback,
}));
vi.mock("@/features/chat/components/chat/ChatPanel", () => ({
  ChatPanel: ({
    initialPlatform,
    initialChannel,
    channelId,
    kickChannelId,
    chatroomId,
    kickUserId,
  }: {
    initialPlatform: string;
    initialChannel: string;
    channelId?: string;
    kickChannelId?: string;
    chatroomId?: number;
    kickUserId?: string;
  }) => (
    <div
      data-testid="chat-panel-boundary"
      data-platform={initialPlatform}
      data-channel={initialChannel}
      data-channel-id={channelId}
      data-kick-channel-id={kickChannelId}
      data-chatroom-id={chatroomId}
      data-kick-user-id={kickUserId}
    />
  ),
}));

import { ModChatPanel, ModVideoPanel } from "@/features/moderation/components/screens/Mod/channel/workspace/ModLivePanels";

// Guards: offline workspace video hands the playback owner an empty identity, preventing an HLS request.
// Guards: Twitch chat uses the resolved route identity without a redundant channel lookup.
// Guards: Kick chat waits for and forwards the canonical IDs owned by channel discovery.
describe("Mod live panel adapters", () => {
  beforeEach(() => {
    mocks.channelQuery.mockReset();
    mocks.streamQuery.mockReset();
    mocks.playback.mockReset();
    mocks.streamQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mocks.playback.mockReturnValue({ playback: null, isLoading: false, error: null });
  });

  it("does not request playback for an offline stream", () => {
    mocks.streamQuery.mockReturnValue({
      data: { isLive: false },
      isLoading: false,
      isError: false,
    });

    renderWithProviders(<ModVideoPanel platform="twitch" channel="offline" channelId="42" />);

    expect(mocks.playback).toHaveBeenCalledWith("twitch", "");
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });

  it("mounts Twitch chat from the resolved route identity without channel discovery", async () => {
    renderWithProviders(<ModChatPanel platform="twitch" channel="ninja" channelId="42" />);

    const panel = await screen.findByTestId("chat-panel-boundary");
    expect(mocks.channelQuery).not.toHaveBeenCalled();
    expect(panel).toHaveAttribute("data-platform", "twitch");
    expect(panel).toHaveAttribute("data-channel-id", "42");
  });

  it("resolves and forwards Kick's canonical chat identities", async () => {
    mocks.channelQuery.mockReturnValue({
      data: {
        id: "legacy-channel-id",
        kickChannelId: "legacy-kick-channel-id",
        kickUserId: "canonical-broadcaster-id",
        chatroomId: 9001,
        isPartner: true,
      },
      isLoading: false,
      isError: false,
    });

    renderWithProviders(<ModChatPanel platform="kick" channel="xqc" channelId="unused" />);

    await waitFor(() => expect(mocks.channelQuery).toHaveBeenCalledWith("xqc", "kick"));
    const panel = await screen.findByTestId("chat-panel-boundary");
    expect(panel).toHaveAttribute("data-channel-id", "legacy-channel-id");
    expect(panel).toHaveAttribute("data-kick-channel-id", "legacy-kick-channel-id");
    expect(panel).toHaveAttribute("data-chatroom-id", "9001");
    expect(panel).toHaveAttribute("data-kick-user-id", "canonical-broadcaster-id");
  });
});
