import { getMentionRange } from "@/features/chat/utils/mention-completion";
import { describe, expect, it } from "vitest";

// Guards: mentions work inside slash-command arguments and replace the entire username when editing in the middle.
// Guards: email-like at signs do not open chat mention suggestions.
describe("mention completion", () => {
  it("finds mentions inside command arguments", () => {
    expect(getMentionRange("/ban @viewer spam", 12)).toEqual({
      start: 5,
      end: 12,
      query: "viewer",
    });
  });

  it("includes the rest of a username after the caret", () => {
    expect(getMentionRange("hello @viewer there", 10)).toEqual({
      start: 6,
      end: 13,
      query: "vie",
    });
  });

  it("rejects embedded email-like at signs", () => {
    expect(getMentionRange("email@viewer", 12)).toBeNull();
  });
});
