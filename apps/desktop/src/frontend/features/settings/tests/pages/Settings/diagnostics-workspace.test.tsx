import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DiagnosticsWorkspace,
  ResourceHistoryStatus,
} from "@/features/settings/components/screens/Settings/diagnostics/DiagnosticsWorkspace";

import { fireEvent, renderWithProviders, screen } from "../../../../../../../tests/test-utils";

vi.mock("@/features/settings/components/hooks/use-diagnostics-workspace", () => ({
  useDiagnosticsWorkspace: () => ({
    kind: "loading" as const,
    snapshot: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/features/settings/components/settings/LogsSection", () => ({
  LogsSection: () => <div>Logs viewer</div>,
}));

vi.mock("@/features/settings/components/settings/BugReportSection", () => ({
  BugReportSection: () => <div>Report builder</div>,
}));

// Guards: switching Diagnostics sections resets the Settings content scroller to the top.
describe("Diagnostics workspace", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("notifies the Settings page when Logs & Reports is selected", () => {
    const onSectionChange = vi.fn(() => {
      expect(screen.getByRole("tab", { name: "Logs & Reports" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });
    renderWithProviders(<DiagnosticsWorkspace onSectionChange={onSectionChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Logs & Reports" }));

    expect(onSectionChange).toHaveBeenCalledOnce();
  });

  // Guards: resource history only shows delayed loading after one second and cancels stale cycles.
  it("delays and cancels the resource history loading spinner across loading cycles", () => {
    vi.useFakeTimers();
    const loading = { kind: "loading" as const, value: null };
    const unavailable = {
      kind: "error" as const,
      value: null,
      diagnosticId: "history-unavailable",
    };
    const { container, rerender, unmount } = renderWithProviders(
      <ResourceHistoryStatus history={loading} live />
    );

    const status = screen.getByText("Loading").closest("span");
    expect(status).toHaveClass("w-24");
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => vi.advanceTimersByTime(999));
    expect(container.querySelector(".animate-spin")).toBeNull();

    rerender(<ResourceHistoryStatus history={unavailable} live />);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".animate-spin")).toBeNull();

    rerender(<ResourceHistoryStatus history={loading} live />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    rerender(<ResourceHistoryStatus history={unavailable} live />);
    expect(container.querySelector(".animate-spin")).toBeNull();

    rerender(<ResourceHistoryStatus history={loading} live />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
