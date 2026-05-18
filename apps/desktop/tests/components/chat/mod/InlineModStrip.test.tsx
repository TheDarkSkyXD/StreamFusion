import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  InlineModStrip,
  type InlineModAction,
  type InlineModStripRoomState,
} from "@/components/chat/mod/InlineModStrip";

const EMPTY_STATE: InlineModStripRoomState = {
  slowMode: null,
  followersOnly: null,
  subscribersOnly: false,
  emoteOnly: false,
  uniqueChat: false,
  shieldMode: false,
};

function setup(props: {
  platform: "twitch" | "kick";
  isBroadcaster: boolean;
  roomState?: Partial<InlineModStripRoomState>;
  onActionClick?: (action: InlineModAction) => void;
}) {
  const onActionClick = props.onActionClick ?? vi.fn();
  render(
    <InlineModStrip
      platform={props.platform}
      isBroadcaster={props.isBroadcaster}
      channelId="c1"
      channelSlug="streamer"
      roomState={{ ...EMPTY_STATE, ...(props.roomState ?? {}) }}
      onActionClick={onActionClick}
    />,
  );
  return { onActionClick };
}

describe("InlineModStrip", () => {
  it("renders 7 icons for a Twitch mod (non-broadcaster) — 4 toggles + clear + unique + shield", () => {
    setup({ platform: "twitch", isBroadcaster: false });
    expect(screen.getByTestId("inline-mod-strip-slow")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-followers")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-subscribers")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-emote")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-clear")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-unique")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-shield")).toBeInTheDocument();
    expect(screen.queryByTestId("inline-mod-strip-raid")).toBeNull();
    expect(screen.queryByTestId("inline-mod-strip-commercial")).toBeNull();
  });

  it("renders all 9 icons for a Twitch broadcaster", () => {
    setup({ platform: "twitch", isBroadcaster: true });
    expect(screen.getByTestId("inline-mod-strip-raid")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-commercial")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-shield")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-unique")).toBeInTheDocument();
  });

  it("renders only 5 icons for Kick (4 chat-mode toggles + clear)", () => {
    setup({ platform: "kick", isBroadcaster: false });
    expect(screen.getByTestId("inline-mod-strip-slow")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-followers")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-subscribers")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-emote")).toBeInTheDocument();
    expect(screen.getByTestId("inline-mod-strip-clear")).toBeInTheDocument();
    expect(screen.queryByTestId("inline-mod-strip-raid")).toBeNull();
    expect(screen.queryByTestId("inline-mod-strip-commercial")).toBeNull();
    expect(screen.queryByTestId("inline-mod-strip-shield")).toBeNull();
    expect(screen.queryByTestId("inline-mod-strip-unique")).toBeNull();
  });

  it("paints the slow-mode toggle active when roomState.slowMode is set", () => {
    setup({ platform: "twitch", isBroadcaster: false, roomState: { slowMode: 30 } });
    expect(screen.getByTestId("inline-mod-strip-slow")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("inline-mod-strip-followers")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("paints the shield + unique toggles active when their flags are true", () => {
    setup({
      platform: "twitch",
      isBroadcaster: false,
      roomState: { shieldMode: true, uniqueChat: true, subscribersOnly: true, emoteOnly: true },
    });
    expect(screen.getByTestId("inline-mod-strip-shield")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("inline-mod-strip-unique")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("inline-mod-strip-subscribers")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("inline-mod-strip-emote")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("fires onActionClick with the correct kind+state for every toggle/icon (Twitch broadcaster)", () => {
    const onActionClick = vi.fn<(action: InlineModAction) => void>();
    setup({
      platform: "twitch",
      isBroadcaster: true,
      roomState: { slowMode: 60, shieldMode: true },
      onActionClick,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-slow"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "slow-mode",
      currentlyActive: true,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-followers"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "followers-only",
      currentlyActive: false,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-subscribers"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "subscribers-only",
      currentlyActive: false,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-emote"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "emote-only",
      currentlyActive: false,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-clear"));
    expect(onActionClick).toHaveBeenLastCalledWith({ kind: "clear" });

    fireEvent.click(screen.getByTestId("inline-mod-strip-raid"));
    expect(onActionClick).toHaveBeenLastCalledWith({ kind: "raid" });

    fireEvent.click(screen.getByTestId("inline-mod-strip-unique"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "unique-chat",
      currentlyActive: false,
    });

    fireEvent.click(screen.getByTestId("inline-mod-strip-commercial"));
    expect(onActionClick).toHaveBeenLastCalledWith({ kind: "commercial" });

    fireEvent.click(screen.getByTestId("inline-mod-strip-shield"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "shield",
      currentlyActive: true,
    });
  });

  it("aria-label reflects the off-vs-on action wording for shield", () => {
    const { onActionClick } = setup({
      platform: "twitch",
      isBroadcaster: false,
      roomState: { shieldMode: false },
    });
    expect(
      screen.getByRole("button", { name: /Enable Shield Mode/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inline-mod-strip-shield"));
    expect(onActionClick).toHaveBeenLastCalledWith({
      kind: "shield",
      currentlyActive: false,
    });
  });
});
