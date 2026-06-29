import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showModActionSuccessToast } from "@/components/chat/mod/mod-action-toast";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

// Guards: production builds suppress debug-only success toasts for completed ban, timeout, and delete moderation actions.
describe("showModActionSuccessToast", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
  });

  it("does not show a success toast in production", () => {
    showModActionSuccessToast("Deleted message", false);

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a success toast in development", () => {
    showModActionSuccessToast("Deleted message", true);

    expect(toast.success).toHaveBeenCalledWith("Deleted message");
  });
});
