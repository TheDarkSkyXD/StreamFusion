import { describe, expect, it } from "vitest";

import { NetworkStatusBanner } from "@/components/layout/NetworkStatusBanner";

import { renderWithProviders, screen } from "../../test-utils";

// Guards: global offline state surfaces a distinct app-level card instead of waiting for platform API failures.
// Guards: automatic reconnect progress remains understandable without exposing a manual retry action.
describe("NetworkStatusBanner", () => {
  it("renders nothing while the app is online", () => {
    const { container } = renderWithProviders(
      <NetworkStatusBanner isOnline={true} isChecking={true} retryInSeconds={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows why internet is required and when the next automatic retry will run", () => {
    renderWithProviders(
      <NetworkStatusBanner isOnline={false} isChecking={false} retryInSeconds={5} />
    );

    const card = screen.getByTestId("network-status-card");
    expect(card).toHaveTextContent("No internet connection");
    expect(card).toHaveTextContent("StreamFusion needs internet to work.");
    expect(card).toHaveTextContent("Trying again in 5 seconds");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a checking state without announcing the ticking countdown", () => {
    renderWithProviders(
      <NetworkStatusBanner isOnline={false} isChecking={true} retryInSeconds={null} />
    );

    expect(screen.getByTestId("network-status-card")).toHaveTextContent("Checking connection…");
    const liveStatus = screen.getByRole("status");
    expect(liveStatus).toHaveTextContent("Checking internet connection.");
    expect(liveStatus).not.toHaveTextContent(/\d+ seconds/);
  });
});
