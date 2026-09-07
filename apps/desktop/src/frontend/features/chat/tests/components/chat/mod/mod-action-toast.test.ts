import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showModActionSuccessToast } from "@/features/chat/components/chat/mod/mod-action-toast";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

// Guards: packaged builds show the same completed-action feedback as development.
describe("showModActionSuccessToast", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
  });

  it("shows a success toast for a completed moderation action", () => {
    showModActionSuccessToast("Deleted message");

    expect(toast.success).toHaveBeenCalledWith("Deleted message");
  });
});
