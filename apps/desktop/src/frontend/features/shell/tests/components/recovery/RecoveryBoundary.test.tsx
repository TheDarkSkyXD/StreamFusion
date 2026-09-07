import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerError = vi.hoisted(() => vi.fn());
vi.mock("@/renderer/logging/logger", () => ({ logger: { error: loggerError } }));

import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";

function Broken({ fail }: { fail: boolean }) {
  if (fail) throw new Error("private failure detail");
  return <p>Recovered content</p>;
}

// Guards: a React render failure leaves a keyboard-reachable recovery action instead of blank UI.
// Guards: renderer diagnostics are logged while raw exception text is not shown to the user.
// Guards: changing a route/reset key clears a regional failure without reloading the whole app.
describe("RecoveryBoundary", () => {
  beforeEach(() => {
    loggerError.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders a safe regional fallback and retries the failed region", () => {
    let fail = true;
    const { rerender } = render(
      <RecoveryBoundary name="Following sidebar">
        <Broken fail={fail} />
      </RecoveryBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Following sidebar hit a problem");
    const retryButton = screen.getByRole("button", { name: "Try again" });
    expect(retryButton).toHaveFocus();
    expect(retryButton).toHaveClass("text-[var(--color-primary-foreground)]");
    expect(screen.queryByText("private failure detail")).not.toBeInTheDocument();
    expect(loggerError).toHaveBeenCalledOnce();

    fail = false;
    rerender(
      <RecoveryBoundary name="Following sidebar">
        <Broken fail={fail} />
      </RecoveryBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });

  it("resets a failed region when its reset key changes", () => {
    const { rerender } = render(
      <RecoveryBoundary name="This page" resetKey="/one">
        <Broken fail />
      </RecoveryBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <RecoveryBoundary name="This page" resetKey="/two">
        <Broken fail={false} />
      </RecoveryBoundary>
    );
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });
});
