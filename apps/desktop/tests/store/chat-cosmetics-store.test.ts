import { beforeEach, describe, expect, it } from "vitest";

import { useChatCosmeticsStore } from "@/store/chat-cosmetics-store";

// Guards: third-party badges merge by provider-qualified identity and never mutate platform-owned ChatMessage.badges arrays.
// Guards: stale entitlement deletes cannot clear a newer 7TV badge or paint selection.
describe("chat cosmetics store", () => {
  beforeEach(() => useChatCosmeticsStore.getState().reset());

  it("merges and deduplicates BTTV, FFZ, and 7TV badges with stable provider IDs", () => {
    const officialBadges = [
      { setId: "moderator", version: "1", imageUrl: "mod.png", title: "Mod" },
    ];
    const state = useChatCosmeticsStore.getState();
    state.setGlobalProviderBadges("bttv", [
      {
        userId: "user-1",
        badge: {
          id: "wrong",
          provider: "bttv",
          providerId: "pro",
          title: "Pro",
          imageUrl: "pro.png",
        },
      },
      {
        userId: "user-1",
        badge: {
          id: "bttv:pro",
          provider: "bttv",
          providerId: "pro",
          title: "Pro",
          imageUrl: "pro.png",
        },
      },
    ]);
    state.setGlobalProviderBadges("ffz", [
      {
        userId: "user-1",
        badge: {
          id: "ffz:supporter",
          provider: "ffz",
          providerId: "supporter",
          title: "Supporter",
          imageUrl: "ffz.png",
        },
      },
    ]);
    state.applySevenTvEvent("channel-1", {
      type: "badge.upsert",
      badge: {
        id: "7tv:founder",
        provider: "7tv",
        providerId: "founder",
        title: "Founder",
        imageUrl: "7tv.png",
      },
    });
    state.applySevenTvEvent("channel-1", {
      type: "assignment.upsert",
      assignment: { userId: "user-1", kind: "badge", cosmeticId: "founder" },
    });

    expect(state.getUserCosmetics("channel-1", "user-1").badges.map((badge) => badge.id)).toEqual([
      "bttv:pro",
      "ffz:supporter",
      "7tv:founder",
    ]);
    expect(officialBadges).toEqual([
      { setId: "moderator", version: "1", imageUrl: "mod.png", title: "Mod" },
    ]);
  });

  it("clears an assignment only when the deleted entitlement still matches", () => {
    const state = useChatCosmeticsStore.getState();
    state.applySevenTvEvent("channel-1", {
      type: "assignment.upsert",
      assignment: { userId: "user-1", kind: "paint", cosmeticId: "paint-new" },
    });
    state.applySevenTvEvent("channel-1", {
      type: "assignment.delete",
      assignment: { userId: "user-1", kind: "paint", cosmeticId: "paint-old" },
    });
    expect(useChatCosmeticsStore.getState().userPaintAssignments.get("channel-1:user-1")).toBe(
      "paint-new"
    );
  });

  it("replaces global provider catalogs without growing per-channel assignments", () => {
    const state = useChatCosmeticsStore.getState();
    state.setGlobalProviderBadges("bttv", [
      {
        userId: "user-1",
        badge: {
          id: "bttv:user-1",
          provider: "bttv",
          providerId: "user-1",
          title: "BTTV",
          imageUrl: "bttv.png",
        },
      },
    ]);
    state.setGlobalProviderBadges("ffz", [
      {
        userId: "user-1",
        badge: {
          id: "ffz:dev",
          provider: "ffz",
          providerId: "dev",
          title: "FFZ",
          imageUrl: "ffz.png",
        },
      },
    ]);

    expect(useChatCosmeticsStore.getState().globalUserBadgeAssignments.size).toBe(1);
    expect(
      state.getUserCosmetics("channel-1", "user-1").badges.map((badge) => badge.provider)
    ).toEqual(["bttv", "ffz"]);
    expect(
      state.getUserCosmetics("channel-2", "user-1").badges.map((badge) => badge.provider)
    ).toEqual(["bttv", "ffz"]);

    state.setGlobalProviderBadges("bttv", []);
    expect(
      state.getUserCosmetics("channel-1", "user-1").badges.map((badge) => badge.provider)
    ).toEqual(["ffz"]);
  });

  it("claims each global provider load once until it fails or completes", () => {
    const state = useChatCosmeticsStore.getState();

    expect(state.beginGlobalProviderLoad("ffz")).toBe(true);
    expect(state.beginGlobalProviderLoad("ffz")).toBe(false);
    state.failGlobalProviderLoad("ffz");
    expect(state.beginGlobalProviderLoad("ffz")).toBe(true);
    state.setGlobalProviderBadges("ffz", []);
    expect(state.beginGlobalProviderLoad("ffz")).toBe(false);
  });

  it("stores FFZ moderator and VIP artwork per channel", () => {
    const state = useChatCosmeticsStore.getState();
    state.setFfzRoleBadges("channel-1", {
      moderator: {
        id: "ffz:room-moderator",
        provider: "ffz",
        providerId: "room-moderator",
        title: "FFZ Moderator",
        imageUrl: "mod.png",
      },
      vip: {
        id: "ffz:room-vip",
        provider: "ffz",
        providerId: "room-vip",
        title: "FFZ VIP",
        imageUrl: "vip.png",
      },
    });

    expect(
      useChatCosmeticsStore.getState().ffzRoleBadges.get("channel-1")?.moderator?.imageUrl
    ).toBe("mod.png");
    state.setFfzRoleBadges("channel-1", {});
    expect(useChatCosmeticsStore.getState().ffzRoleBadges.has("channel-1")).toBe(false);
  });

  it("clears only 7TV state when its channel socket disconnects", () => {
    const state = useChatCosmeticsStore.getState();
    state.setGlobalProviderBadges("bttv", [
      {
        userId: "user-1",
        badge: {
          id: "bttv:user-1",
          provider: "bttv",
          providerId: "user-1",
          title: "BTTV",
          imageUrl: "bttv.png",
        },
      },
    ]);
    state.applySevenTvEvent("channel-1", {
      type: "badge.upsert",
      badge: {
        id: "7tv:founder",
        provider: "7tv",
        providerId: "founder",
        title: "Founder",
        imageUrl: "7tv.png",
      },
    });
    state.applySevenTvEvent("channel-1", {
      type: "assignment.upsert",
      assignment: { userId: "user-1", kind: "badge", cosmeticId: "founder" },
    });
    state.applySevenTvEvent("channel-1", {
      type: "assignment.upsert",
      assignment: { userId: "user-1", kind: "paint", cosmeticId: "paint-1" },
    });

    state.acquireSevenTvChannel("channel-1");
    state.acquireSevenTvChannel("channel-1");
    state.releaseSevenTvChannel("channel-1");

    expect(
      state.getUserCosmetics("channel-1", "user-1").badges.map((badge) => badge.provider)
    ).toEqual(["bttv", "7tv"]);
    expect(useChatCosmeticsStore.getState().userPaintAssignments.has("channel-1:user-1")).toBe(
      true
    );

    state.releaseSevenTvChannel("channel-1");

    expect(
      state.getUserCosmetics("channel-1", "user-1").badges.map((badge) => badge.provider)
    ).toEqual(["bttv"]);
    expect(useChatCosmeticsStore.getState().userPaintAssignments.has("channel-1:user-1")).toBe(
      false
    );
  });
});
