import { describe, expect, it } from "vitest";

import { parseDurationSeconds } from "@/lib/duration";

// Guards: download requests must convert displayed Twitch/Kick video and clip durations into seconds so HLS progress can render a real percent
describe("parseDurationSeconds", () => {
  it("parses colon and Twitch-style duration strings into seconds", () => {
    expect(parseDurationSeconds("1:23:45")).toBe(5025);
    expect(parseDurationSeconds("30s")).toBe(30);
    expect(parseDurationSeconds("3h8m32s")).toBe(11_312);
    expect(parseDurationSeconds("0:00")).toBeNull();
  });
});
