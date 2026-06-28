import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TwitchPinMessageDialog } from "@/components/chat/twitch/TwitchPinMessageDialog";

describe("TwitchPinMessageDialog", () => {
  it("defaults the duration selection to 30 minutes and confirms with 1800 seconds", () => {
    const onConfirm = vi.fn();
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="check the bracket"
        onConfirm={onConfirm}
      />,
    );
    // 30 minutes is Twitch Helix's maximum timed pin duration.
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
        messagePreview="x"
        onConfirm={onConfirm}
      />,
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
        messagePreview="x"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("5 minutes"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(5 * 60);

    rerender(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="x"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("15 minutes"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(15 * 60);
  });

  it("disables the confirm button while busy=true", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="x"
        onConfirm={() => {}}
        busy={true}
      />,
    );
    const btn = screen.getByRole("button", { name: /pinning/i });
    expect(btn).toBeDisabled();
  });

  it("renders the message preview text", () => {
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="hello world"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId("pin-dialog-preview")).toHaveTextContent("hello world");
  });
});
