import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastRoot } from "@/features/shell/components/ToastRoot";
import { UpdateNotice } from "@/features/settings/components/update-notice";

const updater = vi.hoisted(() => ({
  status: "available" as "available" | "downloaded",
  version: "2.3.0",
}));

vi.mock("@/features/settings/components/hooks/useUpdater", () => ({
  useUpdater: () => ({ status: updater.status, updateInfo: { version: updater.version } }),
}));

// Guards: an update found before the Updates tab opens stays visible and links to that tab.
// Guards: a downloaded update remains visible with its install-ready state.
describe("UpdateNotice", () => {
  beforeEach(() => {
    updater.status = "available";
    updater.version = "2.3.0";
  });

  it("shows the available version and opens Updates", async () => {
    const navigate = vi.fn();
    render(
      <>
        <ToastRoot />
        <UpdateNotice navigate={navigate} />
      </>
    );

    expect(await screen.findByText("Version 2.3.0 is available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings", search: { tab: "updates" } });
  });

  it("shows the downloaded state", async () => {
    updater.status = "downloaded";
    render(
      <>
        <ToastRoot />
        <UpdateNotice navigate={vi.fn()} />
      </>
    );

    await waitFor(() => {
      expect(screen.getByText("Update ready to install")).toBeInTheDocument();
    });
  });
});
