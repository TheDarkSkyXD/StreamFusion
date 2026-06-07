import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "../../test-utils";

const mockHook = vi.fn();
vi.mock("@/hooks/usePlatformHealth", () => ({
  usePlatformHealth: () => mockHook(),
}));

import { PlatformHealthBanner } from "@/components/layout/PlatformHealthBanner";

describe("PlatformHealthBanner", () => {
  it("renders nothing when no platform is degraded", () => {
    mockHook.mockReturnValue({ kick: "healthy", twitch: "healthy", anyDegraded: false });
    const { container } = renderWithProviders(<PlatformHealthBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Kick-only copy with Kick brand colors when only Kick is degraded", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Kick is having issues right now. Showing last-known state.");
    expect(banner.className).toMatch(/bg-black/);
    expect(banner.className).toMatch(/text-\[#53FC18\]/);
  });

  it("renders Twitch-only copy with Twitch purple when only Twitch is degraded", () => {
    mockHook.mockReturnValue({ kick: "healthy", twitch: "degraded", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Twitch is having issues right now. Some channels may not load."
    );
    expect(banner.className).toMatch(/bg-\[#9146FF\]/);
    expect(banner.className).toMatch(/text-white/);
  });

  it("renders both-platforms copy with neutral gray when both are degraded", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "degraded", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Kick and Twitch are both having issues right now. Showing last-known state."
    );
    expect(banner.className).toMatch(/bg-gray-700/);
    expect(banner.className).toMatch(/text-white/);
  });

  it("does not render a dismiss / close button", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses role=status so screen readers announce it as live information", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
