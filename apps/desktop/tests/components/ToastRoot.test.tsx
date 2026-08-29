import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";

import { ToastRoot } from "@/features/shell/components/ToastRoot";

// Guards: status toasts stay readable on StreamFusion's dark neutral surface instead of red-on-red or green-on-green rich fills.
describe("ToastRoot", () => {
  it("mounts without throwing", () => {
    expect(() => render(<ToastRoot />)).not.toThrow();
  });

  it("renders a toast.error notification with description", async () => {
    render(<ToastRoot />);

    act(() => {
      toast.error("Couldn't pin message", { description: "Forbidden" });
    });

    // sonner renders toasts in an ol[aria-label="Notifications"]; the message
    // is the visible label of the most-recent toast.
    expect(await screen.findByText("Couldn't pin message")).toBeInTheDocument();
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    const toastElement = screen.getByText("Couldn't pin message").closest("[data-sonner-toast]");
    expect(toastElement).not.toHaveAttribute("data-rich-colors", "true");
    expect(toastElement).toHaveClass("!bg-[#1a1a1a]");
    expect(toastElement).toHaveClass("!border-[#7f1d1d]");
  });

  it("renders a toast.success notification", async () => {
    render(<ToastRoot />);

    act(() => {
      toast.success("Pinned message");
    });

    expect(await screen.findByText("Pinned message")).toBeInTheDocument();
    const toastElement = screen.getByText("Pinned message").closest("[data-sonner-toast]");
    expect(toastElement).not.toHaveAttribute("data-rich-colors", "true");
    expect(toastElement).toHaveClass("!bg-[#1a1a1a]");
    expect(toastElement).toHaveClass("!border-[#256b3a]");
  });
});
