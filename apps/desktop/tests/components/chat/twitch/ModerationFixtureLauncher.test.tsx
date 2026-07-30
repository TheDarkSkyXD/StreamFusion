import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUserPopout = vi.hoisted(() => vi.fn());

vi.mock("@/components/chat/mod/UserPopout/UserPopoutProvider", () => ({
  useOpenUserPopout: () => openUserPopout,
}));

import { ModerationFixtureLauncher } from "@/components/chat/twitch/ModerationFixtureLauncher";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

// Guards: browser and Electron development expose the same deterministic opener.
// Guards: the launcher stays absent without an explicit development fixture.
describe("ModerationFixtureLauncher", () => {
  beforeEach(() => {
    openUserPopout.mockReset();
    useChatStore.setState({ messagesByChannel: {}, usersByChannel: {} });
    window.__STREAMFUSION_BROWSER_DEV_CLIENT__ = true;
    window.history.replaceState({}, "", "/?moderationFixture=history");
  });

  afterEach(() => {
    delete window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
    window.history.replaceState({}, "", "/");
  });

  it("opens the real user-popout context payload from a visible fixture username", () => {
    render(<ModerationFixtureLauncher channel="xqc" channelId="fixture-channel" />);

    expect(screen.getAllByRole("img", { name: /Fixture badge/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Open FixtureUser profile" }));

    expect(openUserPopout).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "fixture-user",
        username: "fixtureuser",
        displayName: "FixtureUser",
        platform: "twitch",
        channelId: "fixture-channel",
        channelSlug: "xqc",
        openingMessage: expect.objectContaining({
          id: "moderation-browser-fixture-message",
          badges: expect.arrayContaining([expect.objectContaining({ title: "Fixture badge 6" })]),
        }),
      })
    );
    expect(useChatStore.getState().messagesByChannel[buildChannelKey("twitch", "xqc")]).toEqual([
      expect.objectContaining({
        id: "moderation-browser-fixture-message",
        badges: expect.arrayContaining([expect.objectContaining({ title: "Fixture badge 6" })]),
      }),
    ]);
  });

  it("does not render without an explicit fixture, but does render in Electron development", () => {
    window.history.replaceState({}, "", "/");
    const { rerender } = render(
      <ModerationFixtureLauncher channel="xqc" channelId="fixture-channel" />
    );
    expect(screen.queryByTestId("moderation-fixture-launcher")).toBeNull();

    window.history.replaceState({}, "", "/?moderationFixture=history");
    delete window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
    rerender(<ModerationFixtureLauncher channel="xqc" channelId="fixture-channel" />);
    expect(screen.getByTestId("moderation-fixture-launcher")).toBeInTheDocument();
  });
});
