import { describe, expect, it } from "vitest";
import { formatMessageTimestamp } from "../domain/message-timestamp";

const message = { id: "1", displayName: "Ada", text: "hello", badges: [] };

describe("chat timestamps", () => {
  it("formats live messages in the selected local clock format", () => {
    const live = {
      ...message,
      receivedAt: new Date(2026, 9, 5, 13, 4, 9).getTime(),
    };
    expect(formatMessageTimestamp(live, "HH:mm:ss")).toBe("13:04:09");
    expect(formatMessageTimestamp(live, "h:mm a")).toBe("1:04 PM");
    expect(formatMessageTimestamp(live, "hh:mm:ss a")).toBe("01:04:09 PM");
  });
  it("uses media time for replay and omits an unknown timestamp", () => {
    expect(
      formatMessageTimestamp({ ...message, offsetSeconds: 3669 }, "HH:mm"),
    ).toBe("01:01:09");
    expect(formatMessageTimestamp(message, "HH:mm")).toBeNull();
  });
});
