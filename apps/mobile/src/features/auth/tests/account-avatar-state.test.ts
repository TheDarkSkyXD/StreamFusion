import { describe, expect, it } from "vitest";

import { shouldShowTwitchAvatar } from "../components/account-avatar-state";

describe("Twitch account avatar fallback", () => {
  it("uses initials when no profile URL exists", () => {
    expect(shouldShowTwitchAvatar(null, null)).toBe(false);
  });

  it("uses initials after the current profile URL fails", () => {
    expect(shouldShowTwitchAvatar("https://cdn.example/first.png", "https://cdn.example/first.png")).toBe(false);
  });

  it("tries a different profile URL after an earlier URL failed", () => {
    expect(shouldShowTwitchAvatar("https://cdn.example/new.png", "https://cdn.example/first.png")).toBe(true);
  });
});
