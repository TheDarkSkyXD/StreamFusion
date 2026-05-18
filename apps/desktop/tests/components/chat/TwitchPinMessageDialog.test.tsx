import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TwitchPinMessageDialog } from "@/components/chat/twitch/TwitchPinMessageDialog";

describe("TwitchPinMessageDialog", () => {
  it("defaults the duration selection to 1 hour and confirms with 3600 seconds", () => {
    const onConfirm = vi.fn();
    render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="check the bracket"
        onConfirm={onConfirm}
      />,
    );
    // 1 hour radio is preselected.
    const oneHour = screen.getByLabelText("1 hour") as HTMLInputElement;
    expect(oneHour.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenCalledWith(3600);
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

  it("confirms with 43200 for 12 hours and 86400 for 24 hours", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="x"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("12 hours"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(12 * 60 * 60);

    rerender(
      <TwitchPinMessageDialog
        open={true}
        onOpenChange={() => {}}
        messagePreview="x"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("24 hours"));
    fireEvent.click(screen.getByRole("button", { name: /pin message/i }));
    expect(onConfirm).toHaveBeenLastCalledWith(24 * 60 * 60);
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
