import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  kickEmotes: [] as Array<{ id: string; subscribersOnly?: boolean }>,
}));

vi.mock("@/features/discovery/data/queries/useChannels", () => ({
  useChannelByUsername: () => ({ data: null }),
}));

vi.mock("@/store/emote-store", () => ({
  useEmoteStore: (selector: (value: unknown) => unknown) =>
    selector({
      getEmotesByProvider: () => new Map([["kick", state.kickEmotes]]),
    }),
}));

vi.mock("@/features/chat/components/chat/EmotePickerPopover", () => ({
  EmotePickerPopover: () => null,
}));

import { NativeEmoteButton } from "@/features/chat/components/chat/input/NativeEmoteButton";

function renderButton(): void {
  render(
    <NativeEmoteButton
      platform="kick"
      channel="ninja"
      channelId="123"
      isOpen={false}
      onOpenRequest={vi.fn()}
      onEmoteSelect={vi.fn()}
    />
  );
}

// Guards: an unloaded Kick emote catalog shows the platform mark instead of a hardcoded sample presented as provider data.
// Guards: a loaded Kick catalog uses an observed provider emote for the trigger image.
describe("NativeEmoteButton", () => {
  beforeEach(() => {
    state.kickEmotes = [];
  });

  it("does not request a fabricated fallback emote while provider data is unavailable", () => {
    renderButton();

    expect(screen.getByRole("button", { name: "Open kick emote picker" })).not.toContainHTML(
      "files.kick.com/emotes/1730762"
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a real non-subscriber provider emote when loaded", () => {
    state.kickEmotes = [{ id: "real-kick-emote" }];

    renderButton();

    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://files.kick.com/emotes/real-kick-emote/fullsize"
    );
  });
});
