import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, routerMock, screen } from "../test-utils";

const useUpdater = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/useAfterFirstPaint", () => ({
  useAfterFirstPaint: () => false,
}));

vi.mock("@/hooks", () => ({
  useAppVersion: vi.fn(),
  useAppVersionInfo: vi.fn(),
  useUpdater,
}));

import { SettingsPage } from "@/pages/Settings";

// Guards: the Settings first frame must not mount updater/preferences panel hooks before paint.
describe("SettingsPage first paint", () => {
  it("renders its lightweight shell before mounting heavy settings content", () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(useUpdater).not.toHaveBeenCalled();
  });
});
