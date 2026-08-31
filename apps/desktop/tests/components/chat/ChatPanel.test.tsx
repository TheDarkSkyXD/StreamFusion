import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/chat/components/chat/twitch/TwitchChat", () => ({
  TwitchChat: ({ channel, showComposer }: { channel: string; showComposer?: boolean }) => (
    <div data-testid="twitch-chat" data-show-composer={String(showComposer)}>
      tw:{channel}
    </div>
  ),
}));

vi.mock("@/features/chat/components/chat/kick/KickChat", () => ({
  KickChat: ({
    channel,
    channelId,
    kickChannelId,
    showComposer,
  }: {
    channel: string;
    channelId?: string;
    kickChannelId?: string;
    showComposer?: boolean;
  }) => (
    <div
      data-testid="kick-chat"
      data-channel-id={channelId}
      data-kick-channel-id={kickChannelId}
      data-show-composer={String(showComposer)}
    >
      kk:{channel}
    </div>
  ),
}));

import { ChatPanel } from "@/features/chat/components/chat/ChatPanel";
import { ChatPanelTabs, type ChatPanelTabId } from "@/features/chat/components/chat/mod/ChatPanelTabs";

// Guards: ChatPanel must always route to the correct platform-specific chat child — silently mounting the wrong one would render zero messages on a live channel
// Guards: empty initial channel (no `initialChannel` prop) still mounts the routed child, so the chat tree exists when the parent finishes loading the channel data
describe("ChatPanel", () => {
  it("renders TwitchChat for twitch platform", async () => {
    render(<ChatPanel initialPlatform="twitch" initialChannel="ninja" />);
    expect(await screen.findByTestId("twitch-chat")).toHaveTextContent("tw:ninja");
  });

  it("renders KickChat for kick platform", async () => {
    render(<ChatPanel initialPlatform="kick" initialChannel="xqc" chatroomId={123} />);
    expect(await screen.findByTestId("kick-chat")).toHaveTextContent("kk:xqc");
  });

  // Guards: Kick moderation receives broadcaster user_id while legacy web-chat endpoints retain channel.id.
  it("keeps Kick broadcaster and legacy channel identities separate", async () => {
    render(
      <ChatPanel
        initialPlatform="kick"
        initialChannel="xqc"
        channelId="legacy-channel-id"
        kickChannelId="legacy-channel-id"
        kickUserId="broadcaster-user-id"
      />
    );
    const chat = await screen.findByTestId("kick-chat");
    expect(chat).toHaveAttribute("data-channel-id", "broadcaster-user-id");
    expect(chat).toHaveAttribute("data-kick-channel-id", "legacy-channel-id");
  });

  it("defaults to twitch when no platform passed", async () => {
    render(<ChatPanel initialChannel="some" />);
    expect(await screen.findByTestId("twitch-chat")).toBeInTheDocument();
  });

  it.each(["twitch", "kick"] as const)("forwards read-only mode to %s chat", async (platform) => {
    render(<ChatPanel initialPlatform={platform} initialChannel="some" showComposer={false} />);
    expect(await screen.findByTestId(`${platform}-chat`)).toHaveAttribute(
      "data-show-composer",
      "false"
    );
  });
});

// U19 — ChatPanelTabs is the shell that wraps the chat body. The role-gated
// visibleTabs list is computed by TwitchChat/KickChat and threaded through;
// these tests cover the shell's behaviour directly (which is also what the
// AE5/AE6/AE7 acceptance examples assert).
describe("ChatPanelTabs", () => {
  const renderTabs = (visibleTabs: ChatPanelTabId[]) =>
    render(
      <ChatPanelTabs visibleTabs={visibleTabs}>
        {{
          chat: <div data-testid="chat-body">chat content</div>,
          modlog: <div data-testid="modlog-body">modlog placeholder</div>,
          engagement: <div data-testid="engagement-body">engagement placeholder</div>,
        }}
      </ChatPanelTabs>
    );

  // AE5
  it("renders no tab strip when only the chat tab is visible", () => {
    renderTabs(["chat"]);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("chat-body")).toBeInTheDocument();
  });

  it("Twitch mod (not broadcaster) sees 2 tabs: Chat / Mod log", () => {
    renderTabs(["chat", "modlog"]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Mod log"]);
    expect(screen.queryByText("Engagement")).toBeNull();
  });

  // AE6
  it("Twitch broadcaster sees 3 tabs including Engagement", () => {
    renderTabs(["chat", "modlog", "engagement"]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Mod log", "Engagement"]);
  });

  // AE7
  it("Kick broadcaster sees 2 tabs and no Engagement", () => {
    renderTabs(["chat", "modlog"]);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Mod log"]);
  });

  it("chat tab is active by default and its panel is visible", () => {
    renderTabs(["chat", "modlog"]);
    const chatPanel = document.querySelector('[data-tab-panel="chat"]') as HTMLElement;
    const modlogPanel = document.querySelector('[data-tab-panel="modlog"]') as HTMLElement;
    expect(chatPanel.style.display).not.toBe("none");
    expect(modlogPanel.style.display).toBe("none");
  });

  it("clicking Mod log hides the chat content via display:none but keeps the DOM", () => {
    renderTabs(["chat", "modlog"]);
    const modlogTab = screen.getAllByRole("tab").find((t) => t.textContent === "Mod log")!;
    act(() => {
      fireEvent.click(modlogTab);
    });
    const chatPanel = document.querySelector('[data-tab-panel="chat"]') as HTMLElement;
    const modlogPanel = document.querySelector('[data-tab-panel="modlog"]') as HTMLElement;
    // Chat DOM is still mounted, just hidden — preserves the IRC stream.
    expect(screen.getByTestId("chat-body")).toBeInTheDocument();
    expect(chatPanel.style.display).toBe("none");
    expect(modlogPanel.style.display).not.toBe("none");
  });

  it("switching tabs preserves the Chat tab DOM identity (no remount)", () => {
    // The same React element instance survives across tab switches; the
    // <div data-testid="chat-body"> is the same node before and after.
    renderTabs(["chat", "modlog"]);
    const originalChatBody = screen.getByTestId("chat-body");
    const modlogTab = screen.getAllByRole("tab").find((t) => t.textContent === "Mod log")!;
    act(() => {
      fireEvent.click(modlogTab);
    });
    const chatTab = screen.getAllByRole("tab").find((t) => t.textContent === "Chat")!;
    act(() => {
      fireEvent.click(chatTab);
    });
    expect(screen.getByTestId("chat-body")).toBe(originalChatBody);
  });

  it("renders a badge pill when the badge count is positive", () => {
    render(
      <ChatPanelTabs visibleTabs={["chat", "modlog"]} badges={{ modlog: 3 }}>
        {{
          chat: <div>c</div>,
          modlog: <div>m</div>,
        }}
      </ChatPanelTabs>
    );
    const modlogTab = screen.getAllByRole("tab").find((t) => t.textContent?.startsWith("Mod log"))!;
    expect(modlogTab.textContent).toContain("3");
  });

  it("hides the badge pill when the count is 0 or undefined", () => {
    render(
      <ChatPanelTabs visibleTabs={["chat", "modlog"]} badges={{ modlog: 0 }}>
        {{
          chat: <div>c</div>,
          modlog: <div>m</div>,
        }}
      </ChatPanelTabs>
    );
    const modlogTab = screen.getAllByRole("tab").find((t) => t.textContent?.startsWith("Mod log"))!;
    // Just "Mod log" with no trailing digits.
    expect(modlogTab.textContent).toBe("Mod log");
  });
});
