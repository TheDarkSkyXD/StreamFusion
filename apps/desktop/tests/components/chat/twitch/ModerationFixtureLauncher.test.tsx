import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModerationFixtureLauncher } from "@/components/chat/twitch/ModerationFixtureLauncher";
import { useChatStore } from "@/store/chat-store";

// Guards: moderation fixtures never inject a synthetic user, message, badge, or profile opener.
// Guards: the launcher stays absent without an explicit development fixture.
describe("ModerationFixtureLauncher", () => {
  beforeEach(() => {
    useChatStore.setState({ messagesByChannel: {}, usersByChannel: {} });
    window.history.replaceState({}, "", "/?moderationFixture=history");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders only a state banner and instructs the developer to select a real chat user", () => {
    render(<ModerationFixtureLauncher />);

    expect(screen.getByTestId("moderation-fixture-launcher")).toHaveTextContent(
      "Select a real chat user"
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(useChatStore.getState().messagesByChannel).toEqual({});
  });

  it("does not render without an explicit fixture, but does render in Electron development", () => {
    window.history.replaceState({}, "", "/");
    const { rerender } = render(<ModerationFixtureLauncher />);
    expect(screen.queryByTestId("moderation-fixture-launcher")).toBeNull();

    window.history.replaceState({}, "", "/?moderationFixture=history");
    rerender(<ModerationFixtureLauncher />);
    expect(screen.getByTestId("moderation-fixture-launcher")).toBeInTheDocument();
  });
});
