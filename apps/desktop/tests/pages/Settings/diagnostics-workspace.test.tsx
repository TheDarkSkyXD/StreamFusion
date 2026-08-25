import { describe, expect, it, vi } from "vitest";

import { DiagnosticsWorkspace } from "@/pages/Settings/diagnostics/DiagnosticsWorkspace";

import { fireEvent, renderWithProviders, screen } from "../../test-utils";

vi.mock("@/hooks/use-diagnostics-workspace", () => ({
  useDiagnosticsWorkspace: () => ({
    kind: "loading" as const,
    snapshot: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/settings/LogsSection", () => ({
  LogsSection: () => <div>Logs viewer</div>,
}));

vi.mock("@/components/settings/BugReportSection", () => ({
  BugReportSection: () => <div>Report builder</div>,
}));

// Guards: switching Diagnostics sections resets the Settings content scroller to the top.
describe("Diagnostics workspace", () => {
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
});
