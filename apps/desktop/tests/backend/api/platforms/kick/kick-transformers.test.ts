import { describe, expect, it } from "vitest";

// Guards: dual-id rule — `id` MUST come from the response's `channel.id` field,
// NOT from `user_id`. Mixing the two regenerates the 2026-05-15 follow-mismatch
// bug (see docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md).
// Guards: transformer returns null on rows missing both id and slug —
// channelsMatch needs at least one of platform+id or platform+slug for identity.
// Guards: optional-chaining defense — a v2 response with missing user.profile_pic
// must produce a UnifiedChannel with empty avatarUrl, not throw.

import { transformKickFollowedChannelLegacy } from "../../../../../src/backend/api/platforms/kick/kick-transformers";
import type { KickLegacyApiFollowedChannel } from "../../../../../src/backend/api/platforms/kick/kick-types";

describe("transformKickFollowedChannelLegacy", () => {
  it("maps a fully-populated nested-user shape", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
      user: {
        id: 421500,
        username: "Summit1G",
        profile_pic: "https://files.kick.com/images/user/421500/profile.webp",
      },
      livestream: { is_live: true },
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result).toEqual({
      id: "411439",
      platform: "kick",
      username: "summit1g",
      displayName: "Summit1G",
      avatarUrl: "https://files.kick.com/images/user/421500/profile.webp",
      bannerUrl: undefined,
      bio: undefined,
      isLive: true,
      isVerified: false,
      isPartner: false,
    });
  });

  it("uses channel.id (not user_id) for UnifiedChannel.id", () => {
    // Critical regression: dual-id rule. Both fields populated, different values.
    const item: KickLegacyApiFollowedChannel = {
      id: 411439, // channel.id — what we want
      user_id: 421500, // legacy field — must NOT win
      slug: "summit1g",
      user: { username: "Summit1G", profile_pic: "https://example.com/a.webp" },
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.id).toBe("411439");
  });

  it("falls back to flat top-level fields when user nesting is absent", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
      username: "Summit1G",
      profile_pic: "https://files.kick.com/images/user/421500/profile.webp",
      is_live: false,
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.displayName).toBe("Summit1G");
    expect(result?.avatarUrl).toBe("https://files.kick.com/images/user/421500/profile.webp");
    expect(result?.isLive).toBe(false);
  });

  it("does not throw and returns empty avatar when user.profile_pic is missing", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
      user: { username: "Summit1G" }, // no profile_pic
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.avatarUrl).toBe("");
  });

  it("does not throw when the user block is missing entirely", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.displayName).toBe("summit1g"); // slug fallback
    expect(result?.avatarUrl).toBe("");
    expect(result?.isLive).toBe(false);
  });

  it("returns null when both id and slug are missing", () => {
    const item: KickLegacyApiFollowedChannel = {
      user: { username: "orphan" },
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result).toBeNull();
  });

  it("accepts slug-only rows by coercing id to empty string (slug-bridge identity)", () => {
    // channelsMatch can identify by platform+slug alone. Empty id is the
    // documented sentinel for "canonical id not yet known" — see follow-store
    // upgradeFollowIfNeeded.
    const item: KickLegacyApiFollowedChannel = {
      slug: "summit1g",
      user: { username: "Summit1G" },
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.id).toBe("");
    expect(result?.username).toBe("summit1g");
  });

  it("coerces numeric id to string", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(typeof result?.id).toBe("string");
    expect(result?.id).toBe("411439");
  });

  it("treats null livestream as not-live", () => {
    const item: KickLegacyApiFollowedChannel = {
      id: 411439,
      slug: "summit1g",
      livestream: null,
    };

    const result = transformKickFollowedChannelLegacy(item);

    expect(result?.isLive).toBe(false);
  });
});
