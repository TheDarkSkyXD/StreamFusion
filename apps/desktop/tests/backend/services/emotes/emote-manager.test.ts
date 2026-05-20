import { describe, expect, it, vi } from "vitest";

import { EmoteManager } from "@/backend/services/emotes/emote-manager";
import type { Emote, EmoteProvider, EmoteProviderService } from "@/backend/services/emotes/emote-types";

function makeProvider(name: EmoteProvider): EmoteProviderService & {
  fetchGlobalEmotes: ReturnType<typeof vi.fn>;
  fetchChannelEmotes: ReturnType<typeof vi.fn>;
} {
  return {
    name,
    fetchGlobalEmotes: vi.fn(async () => [] as Emote[]),
    fetchChannelEmotes: vi.fn(async () => [] as Emote[]),
    getEmoteUrl: (e: Emote) => e.urls.url2x,
  };
}

describe("EmoteManager.loadGlobalEmotes platform filter", () => {
  it("does not invoke Twitch-only providers when platform is 'kick'", async () => {
    const manager = new EmoteManager();
    const twitch = makeProvider("twitch");
    const kick = makeProvider("kick");
    const bttv = makeProvider("bttv");
    const ffz = makeProvider("ffz");
    const sevenTV = makeProvider("7tv");
    manager.registerProvider(twitch);
    manager.registerProvider(kick);
    manager.registerProvider(bttv);
    manager.registerProvider(ffz);
    manager.registerProvider(sevenTV);

    await manager.loadGlobalEmotes("kick");

    // Twitch / BTTV / FFZ globals don't apply on Kick streams.
    expect(twitch.fetchGlobalEmotes).not.toHaveBeenCalled();
    expect(bttv.fetchGlobalEmotes).not.toHaveBeenCalled();
    expect(ffz.fetchGlobalEmotes).not.toHaveBeenCalled();
    // Kick + 7TV serve Kick streams. Kick's loader is a documented no-op,
    // but it's still in the platform allowlist (the same map drives channel
    // emote loading, where Kick is required).
    expect(kick.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
    expect(sevenTV.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
  });

  it("does not invoke Kick's global loader when platform is 'twitch'", async () => {
    const manager = new EmoteManager();
    const twitch = makeProvider("twitch");
    const kick = makeProvider("kick");
    const bttv = makeProvider("bttv");
    const ffz = makeProvider("ffz");
    const sevenTV = makeProvider("7tv");
    manager.registerProvider(twitch);
    manager.registerProvider(kick);
    manager.registerProvider(bttv);
    manager.registerProvider(ffz);
    manager.registerProvider(sevenTV);

    await manager.loadGlobalEmotes("twitch");

    // This is the actual bug from the report — Kick's no-op global loader
    // must not run on a Twitch stream.
    expect(kick.fetchGlobalEmotes).not.toHaveBeenCalled();
    expect(twitch.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
    expect(bttv.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
    expect(ffz.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
    expect(sevenTV.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
  });

  it("loads from every enabled provider when called with no platform (legacy behavior)", async () => {
    const manager = new EmoteManager();
    const twitch = makeProvider("twitch");
    const kick = makeProvider("kick");
    manager.registerProvider(twitch);
    manager.registerProvider(kick);

    await manager.loadGlobalEmotes();

    expect(twitch.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
    expect(kick.fetchGlobalEmotes).toHaveBeenCalledTimes(1);
  });
});
