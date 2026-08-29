import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "../../test-utils";

const mockHook = vi.fn();
vi.mock("@/features/settings/data/usePlatformHealth", () => ({
  usePlatformHealth: () => mockHook(),
}));

import { PlatformHealthIndicator } from "@/features/shell/components/layout/PlatformHealthIndicator";

// Guards: long-running Platform degradation stays in compact top-nav chrome instead of reducing every page's content height.
// Guards: the full provider incident remains available to assistive technology while visible copy stays brief.
describe("PlatformHealthIndicator", () => {
  it("renders nothing when no platform is degraded", () => {
    mockHook.mockReturnValue({ kick: "healthy", twitch: "healthy", anyDegraded: false });
    const { container } = renderWithProviders(<PlatformHealthIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for Kick-only degraded health without status-page detail", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    const { container } = renderWithProviders(<PlatformHealthIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Kick-down copy with Kick brand colors when Kick is unreachable", () => {
    mockHook.mockReturnValue({ kick: "down", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveTextContent("Kick offline");
    expect(indicator).toHaveAccessibleName("Kick is unreachable. Retrying.");
    expect(indicator).toHaveClass("h-8", "rounded-full");
    expect(indicator.className).toMatch(/text-\[#8aff62\]/);
  });

  it("renders Kick status-page detail when available", () => {
    mockHook.mockReturnValue({
      kick: "degraded",
      twitch: "healthy",
      anyDegraded: true,
      details: {
        kick: { summary: "Kick status: Major outage - KICK Outage." },
      },
    });
    renderWithProviders(<PlatformHealthIndicator />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Kick status: Major outage - KICK Outage."
    );
  });

  it("renders Twitch-only copy with Twitch purple when only Twitch is degraded", () => {
    mockHook.mockReturnValue({ kick: "healthy", twitch: "degraded", anyDegraded: true });
    renderWithProviders(<PlatformHealthIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveTextContent("Twitch degraded");
    expect(indicator).toHaveAccessibleName("Twitch is degraded. Some channels may not load.");
    expect(indicator.className).toMatch(/bg-\[#9146FF\]/);
  });

  it("renders Twitch-only copy when Twitch is degraded and Kick is internally degraded", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "degraded", anyDegraded: true });
    renderWithProviders(<PlatformHealthIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveTextContent("Twitch degraded");
    expect(indicator).toHaveAccessibleName("Twitch is degraded. Some channels may not load.");
  });

  it("renders both-platforms copy when Twitch is degraded and Kick has status-page detail", () => {
    mockHook.mockReturnValue({
      kick: "degraded",
      twitch: "degraded",
      anyDegraded: true,
      details: {
        kick: { summary: "Kick status: Partial outage." },
      },
    });
    renderWithProviders(<PlatformHealthIndicator />);
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveTextContent("Platform issues");
    expect(indicator).toHaveAccessibleName(
      "Kick and Twitch are degraded. Some data may be cached or delayed."
    );
    expect(indicator.className).toMatch(/bg-amber-300/);
  });

  it("does not render a dismiss / close button", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthIndicator />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses role=status so screen readers announce it as live information", () => {
    mockHook.mockReturnValue({
      kick: "degraded",
      twitch: "healthy",
      anyDegraded: true,
      details: {
        kick: { summary: "Kick status: Partial outage." },
      },
    });
    renderWithProviders(<PlatformHealthIndicator />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
