import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { showErrorToast } from "@/lib/error-toast";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Guards: operational errors remain visible long enough to copy their title and details for support.
// Guards: clipboard failures stay contained and surface readable feedback without another copy action.
describe("showErrorToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows a 15-second error toast whose action copies the error", async () => {
    const title = "Playback failed";
    const description = "The stream request timed out";

    showErrorToast(title, { description });

    expect(toast.error).toHaveBeenCalledWith(
      title,
      expect.objectContaining({
        duration: 15_000,
        description,
        action: expect.objectContaining({
          label: "Copy error",
          onClick: expect.any(Function),
        }),
      })
    );

    const toastOptions = vi.mocked(toast.error).mock.calls[0]?.[1] as {
      action?: { onClick: () => void | Promise<void> };
    };
    if (!toastOptions.action) throw new Error("Expected a Copy error action");

    await toastOptions.action.onClick();

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copiedError = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    expect(copiedError).toContain(title);
    expect(copiedError).toContain(description);
    expect(copiedError?.indexOf(title)).toBeLessThan(copiedError?.indexOf(description) ?? -1);
    expect(toast.success).toHaveBeenCalledWith("Error copied");
  });

  it("contains clipboard failures and shows a non-copyable error toast", async () => {
    const clipboardFailure = "Clipboard permission denied";
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error(clipboardFailure));

    showErrorToast("Playback failed", { description: "The stream request timed out" });

    const toastOptions = vi.mocked(toast.error).mock.calls[0]?.[1] as {
      action?: { onClick: () => void | Promise<void> };
    };
    if (!toastOptions.action) throw new Error("Expected a Copy error action");
    vi.mocked(toast.error).mockClear();

    await expect(toastOptions.action.onClick()).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith("Couldn't copy error", {
      description: clipboardFailure,
    });
    const failureToastOptions = vi.mocked(toast.error).mock.calls[0]?.[1] as {
      action?: unknown;
    };
    expect(failureToastOptions.action).toBeUndefined();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
