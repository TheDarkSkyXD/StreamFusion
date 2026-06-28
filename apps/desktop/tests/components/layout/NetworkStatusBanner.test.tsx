import { describe, expect, it } from "vitest";

import { NetworkStatusBanner } from "@/components/layout/NetworkStatusBanner";

import { renderWithProviders, screen } from "../../test-utils";

// Guards: global offline state surfaces a distinct app-level banner instead of waiting for platform API failures.
describe("NetworkStatusBanner", () => {
  it("renders nothing while the app is online", () => {
    const { container } = renderWithProviders(<NetworkStatusBanner isOnline={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an offline status when the app is offline", () => {
    renderWithProviders(<NetworkStatusBanner isOnline={false} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("No internet connection");
    expect(banner).toHaveTextContent("StreamFusion will reconnect when you're back online.");
  });
});
