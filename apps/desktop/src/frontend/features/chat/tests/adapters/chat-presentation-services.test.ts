import { beforeEach, describe, expect, it, vi } from "vitest";
import { installElectronAPIMock } from "../../../../../../tests/test-utils";
import { getDesktopChatPresentationServices } from "../../adapters/electron/chat-presentation-services";

describe("chat badge presentation adapter", () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    api.emotes.bttv.getBadges = vi.fn();
    api.emotes.ffz.getBadges = vi.fn();
    api.emotes.ffz.getRoom = vi.fn();
  });

  it("normalizes global badge identities, images, and fallback titles without changing provider payloads", async () => {
    const bttv = [{ providerId: "supporter", badge: { description: "", svg: "//cdn/bttv.svg" } }];
    const ffz = {
      badges: [
        {
          id: 9,
          title: "",
          color: "#abc",
          slot: 2,
          replaces: "moderator",
          urls: { "1": "cdn/small", "2": "cdn/medium" },
        },
      ],
      users: { "9": [42], missing: [43] },
    };
    vi.mocked(window.electronAPI.emotes.bttv.getBadges).mockResolvedValue({
      kind: "ok",
      value: bttv,
    });
    vi.mocked(window.electronAPI.emotes.ffz.getBadges).mockResolvedValue({
      kind: "ok",
      value: ffz,
    });
    const originalPayloads = structuredClone({ bttv, ffz });
    const services = getDesktopChatPresentationServices()!;

    await expect(services.getGlobalBadges("bttv", "Supporter")).resolves.toEqual([
      {
        userId: "supporter",
        badge: {
          id: "bttv:supporter",
          provider: "bttv",
          providerId: "supporter",
          title: "Supporter",
          imageUrl: "https://cdn/bttv.svg",
        },
      },
    ]);
    await expect(services.getGlobalBadges("ffz", "Contributor")).resolves.toEqual([
      {
        userId: "42",
        badge: {
          id: "ffz:9",
          provider: "ffz",
          providerId: "9",
          title: "Contributor",
          imageUrl: "https://cdn/medium",
          color: "#abc",
          slot: 2,
          replaces: "moderator",
        },
      },
    ]);
    expect({ bttv, ffz }).toEqual(originalPayloads);
  });

  it("normalizes channel role badges and preserves translated labels and missing roles", async () => {
    vi.mocked(window.electronAPI.emotes.ffz.getRoom).mockResolvedValue({
      kind: "ok",
      value: {
        room: {
          set: 1,
          mod_urls: { "1": "https://cdn/small", "4": "https://cdn/large" },
          vip_badge: null,
        },
        sets: {},
      },
    });

    await expect(
      getDesktopChatPresentationServices()!.getChannelRoleBadges("ninja", {
        moderator: "Modérateur",
        vip: "VIP",
      })
    ).resolves.toEqual({
      moderator: {
        id: "ffz:room-moderator",
        provider: "ffz",
        providerId: "room-moderator",
        title: "Modérateur",
        imageUrl: "https://cdn/large",
      },
      vip: undefined,
    });
    expect(window.electronAPI.emotes.ffz.getRoom).toHaveBeenCalledWith({
      kind: "name",
      name: "ninja",
    });
  });

  it("rejects failed catalog reads so the UI can release its loading claim", async () => {
    vi.mocked(window.electronAPI.emotes.bttv.getBadges).mockRejectedValue(new Error("offline"));
    await expect(
      getDesktopChatPresentationServices()!.getGlobalBadges("bttv", "Badge")
    ).rejects.toThrow("offline");
  });

  it("reports bridge availability at use time instead of capturing the first bridge", () => {
    const bridge = window.electronAPI;
    try {
      Object.defineProperty(window, "electronAPI", { value: undefined, configurable: true });
      expect(getDesktopChatPresentationServices()).toBeUndefined();
    } finally {
      Object.defineProperty(window, "electronAPI", { value: bridge, configurable: true });
    }
    expect(getDesktopChatPresentationServices()).toBeDefined();
  });
});
