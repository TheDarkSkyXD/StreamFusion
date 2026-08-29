import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TwitchPinMessageDialog } from "@/features/chat/components/chat/twitch/TwitchPinMessageDialog";
import type { ChatMessage } from "@shared/chat-types";
import { installElectronAPIMock } from "../../test-utils";

// Guards: the pin-message dialog must offer the same preset/custom duration choices as the pinned-message options menu, and it must report durations in seconds to the Twitch pin mutation.
// Guards: the preview renders the real chat message shape, including sender metadata and emote fragments, instead of flattening to raw text.
describe("TwitchPinMessageDialog", () => {
  const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: "msg-1",
    platform: "twitch",
    type: "message",
    channel: "ninja",
    userId: "user-1",
    username: "baduser",
    displayName: "BadUser",
    color: "#ff7a18",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/baduser-profile_image.png",
    badges: [],
    content: [{ type: "text", content: "check the bracket" }],
    rawContent: "check the bracket",
    timestamp: new Date("2026-06-29T15:00:00.000Z"),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    ...overrides,
  });
  const textMessage = (content: string) =>
    message({
      content: [{ type: "text", content }],
      rawContent: content,
    });

  it("defaults the duration selection to 30 minutes and confirms with 1800 seconds", () => {
    const onConfirm = vi.fn();
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={message()}
        onConfirm={onConfirm}
      />
    );
    const thirtyMinutes = screen.getByLabelText("30 minutes") as HTMLInputElement;
    expect(thirtyMinutes.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenCalledWith(1800);
  });

  it("confirms with null when 'No expiry' is selected", () => {
    const onConfirm = vi.fn();
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByLabelText("No expiry"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("confirms with valid Helix timed durations", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByLabelText("1 minute"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(60);

    rerender(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByLabelText("5 minutes"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(5 * 60);

    rerender(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByLabelText("15 minutes"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(15 * 60);
  });

  it("confirms custom seconds and minutes as seconds", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Custom pin duration"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Custom pin duration unit"), {
      target: { value: "seconds" },
    });
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(45);

    rerender(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Custom pin duration"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Custom pin duration unit"), {
      target: { value: "minutes" },
    });
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(120);
  });

  it("disables confirm for invalid custom duration values", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Custom pin duration"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /pin message/i })).toBeDisabled();
  });

  it("disables the confirm button while busy=true", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("x")}
        onConfirm={() => {}}
        busy={true}
      />
    );
    const btn = screen.getByRole("button", { name: /pinning/i });
    expect(btn).toBeDisabled();
  });

  it("renders the message preview text", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={textMessage("hello world")}
        onConfirm={() => {}}
      />
    );
    expect(screen.getByTestId("pin-dialog-preview")).toHaveTextContent("hello world");
  });

  it("renders the sender name, avatar fallback, and emote image in the preview", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={message({
          displayName: "CoolUser",
          avatarUrl: "",
          content: [
            { type: "text", content: "look " },
            {
              type: "emote",
              id: "25",
              name: "Kappa",
              url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
            },
          ],
          rawContent: "look Kappa",
        })}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByTestId("pin-dialog-preview")).toHaveTextContent("CoolUser");
    expect(screen.getByTestId("pin-dialog-preview")).toHaveTextContent("look");
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Kappa emote details" })).toBeInTheDocument();
    expect(screen.getByAltText("Kappa")).toBeInTheDocument();
  });

  it("looks up the Twitch sender avatar when the chat message has no avatar URL", async () => {
    const api = installElectronAPIMock();
    api.channels.getByUsername = vi.fn<typeof api.channels.getByUsername>(async () => ({
      success: true,
      data: {
        id: "lookup-id",
        platform: "twitch",
        username: "lookupuser",
        displayName: "LookupUser",
        avatarUrl: "https://example.com/lookup-avatar.png",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    }));

    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        message={message({
          username: "lookupuser",
          displayName: "LookupUser",
          avatarUrl: "",
        })}
        onConfirm={() => {}}
      />
    );

    await waitFor(() =>
      expect(api.channels.getByUsername).toHaveBeenCalledWith({
        platform: "twitch",
        username: "lookupuser",
      })
    );
    await waitFor(() => expect(screen.getByAltText("LookupUser")).toBeInTheDocument());
    expect(screen.getByAltText("LookupUser")).toHaveAttribute(
      "src",
      "https://example.com/lookup-avatar.png"
    );
  });
});
