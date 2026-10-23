import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dev/DeveloperConsole", () => ({
  DeveloperConsole: () => <button>Developer Console</button>,
}));
vi.mock("@/providers/query-provider", () => ({
  queryClient: {},
  FallbackQueryDevtools: () => <button>Open Tanstack query devtools</button>,
}));
vi.mock("../adapters/electron/developer-widget-overlay", () => ({
  electronDeveloperWidgetOverlay: {
    supported: () => true,
    arm: async () => false,
    updateLayout: async () => ({ applied: false, revision: -1 }),
    close: async () => undefined,
  },
}));

import { DeveloperWidgetOverlay } from "../components/dev/developer-widget-overlay";

describe("developer widget host failure", () => {
  it("keeps both developer widgets available when the native host declines", async () => {
    render(<DeveloperWidgetOverlay />);
    expect(await screen.findByRole("button", { name: "Developer Console" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Tanstack query devtools" })
    ).toBeInTheDocument();
  });
});
