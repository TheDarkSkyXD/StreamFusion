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

  it("renders nothing for Kick-only degraded health without status-page detail", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    const { container } = renderWithProviders(<PlatformHealthBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Kick-down copy with Kick brand colors when Kick is unreachable", () => {
    mockHook.mockReturnValue({ kick: "down", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Kick is unreachable. Retrying...");
    expect(banner.className).toMatch(/bg-black/);
    expect(banner.className).toMatch(/text-\[#53FC18\]/);
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
    renderWithProviders(<PlatformHealthBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kick status: Major outage - KICK Outage."
    );
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

  it("renders Twitch-only copy when Twitch is degraded and Kick is internally degraded", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "degraded", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Twitch is having issues right now. Some channels may not load."
    );
    expect(banner.className).toMatch(/bg-\[#9146FF\]/);
    expect(banner.className).toMatch(/text-white/);
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
    renderWithProviders(<PlatformHealthBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Kick and Twitch are degraded right now. Some data may be cached or delayed."
    );
    expect(banner.className).toMatch(/bg-neutral-700/);
    expect(banner.className).toMatch(/text-white/);
  });

  it("does not render a dismiss / close button", () => {
    mockHook.mockReturnValue({ kick: "degraded", twitch: "healthy", anyDegraded: true });
    renderWithProviders(<PlatformHealthBanner />);
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
    renderWithProviders(<PlatformHealthBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
