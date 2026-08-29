import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveNotificationToast } from "@/features/auth/components/LiveNotificationToast";

// Guards: long live-alert titles remain fully readable instead of being truncated to one line.
describe("LiveNotificationToast", () => {
  it("wraps long stream titles without hiding overflow", () => {
    const longTitle =
      "A very long stream title that needs several lines to remain completely visible in the toast";

    render(
      <LiveNotificationToast
        notification={{
          id: "live-long-title",
          platform: "kick",
          channelId: "100",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          title: longTitle,
          createdAt: Date.now(),
        }}
      />
    );

    expect(screen.getByText(longTitle)).toHaveClass("whitespace-normal", "break-words");
    expect(screen.getByText(longTitle)).not.toHaveClass("truncate", "overflow-hidden");
  });
});
