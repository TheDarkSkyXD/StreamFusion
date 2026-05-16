import { describe, expect, it } from "vitest";

import { channelsMatch } from "@/lib/id-utils";

describe("channelsMatch", () => {
  it("returns false across platforms even when id and username both match", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "12345", username: "xqc" },
        { platform: "kick", id: "12345", username: "xqc" }
      )
    ).toBe(false);
  });

  it("returns true on same platform with different ids but matching slug (legacy Kick user_id vs channel.id)", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "421500", username: "chickenandy" },
        { platform: "kick", id: "411439", username: "chickenandy" }
      )
    ).toBe(true);
  });

  it("returns true on same id even when usernames differ (channel renamed)", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "42", username: "old_handle" },
        { platform: "twitch", id: "42", username: "new_handle" }
      )
    ).toBe(true);
  });

  it("returns false when both ids are empty and usernames differ", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "", username: "alice" },
        { platform: "kick", id: "", username: "bob" }
      )
    ).toBe(false);
  });

  it("falls back to username when one side has no id", () => {
    expect(
      channelsMatch(
        { platform: "twitch", id: "", username: "lirik" },
        { platform: "twitch", id: "23161357", username: "lirik" }
      )
    ).toBe(true);
  });

  it("matches username case-insensitively", () => {
    expect(
      channelsMatch(
        { platform: "kick", id: "676", username: "xQc" },
        { platform: "kick", id: "999", username: "XQC" }
      )
    ).toBe(true);
  });
});
