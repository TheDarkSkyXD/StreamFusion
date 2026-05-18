import { render, screen, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toast } from "sonner";

import { ToastRoot } from "@/components/ToastRoot";

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
  });

  it("renders a toast.success notification", async () => {
    render(<ToastRoot />);

    act(() => {
      toast.success("Pinned message");
    });

    expect(await screen.findByText("Pinned message")).toBeInTheDocument();
  });
});
