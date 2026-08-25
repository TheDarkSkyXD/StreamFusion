import { describe, expect, it } from "vitest";

import { isAllowedPlatformImageUrl, resolveProxiedImageSrc } from "@/lib/proxied-image-url";

// Guards: Kick replay accepts the observed ext.cdn badge host without allowing HTTP or hostname-confusion variants.
// Guards: browser development uses the HTTP media relay while Electron keeps its custom image protocol
describe("proxied image URL policy", () => {
  it("rejects Twitch processing placeholders without issuing a network request", () => {
    expect(
      resolveProxiedImageSrc("https://vod-secure.twitch.tv/_404/404_processing_90x60.png")
    ).toBeNull();
    expect(
      resolveProxiedImageSrc("https://vod-secure.twitch.tv/_404/404_processing_320x180.png")
    ).toBeNull();
    expect(
      resolveProxiedImageSrc("https://example.test/_404/404_processing_90x60.png")
    ).toBe("https://example.test/_404/404_processing_90x60.png");
    expect(resolveProxiedImageSrc("https://vod-secure.twitch.tv/vod/123.png")).toBe(
      "https://vod-secure.twitch.tv/vod/123.png"
    );
  });

  it("allows only the exact HTTPS Kick extension CDN host", () => {
    const badgeUrl = "https://ext.cdn.kick.com/chat/badges/subscriber.png";

    expect(isAllowedPlatformImageUrl(badgeUrl, "kick")).toBe(true);
    expect(resolveProxiedImageSrc(badgeUrl)).toMatch(/^kick-image:\/\/image\?u=/);
    expect(
      isAllowedPlatformImageUrl("http://ext.cdn.kick.com/chat/badges/subscriber.png", "kick")
    ).toBe(false);
    expect(
      isAllowedPlatformImageUrl(
        "https://ext.cdn.kick.com.attacker.test/chat/badges/subscriber.png",
        "kick"
      )
    ).toBe(false);
    expect(
      isAllowedPlatformImageUrl(
        "https://attacker.ext.cdn.kick.com/chat/badges/subscriber.png",
        "kick"
      )
    ).toBe(false);
  });

  it("uses the same-origin image relay only in the browser development client", () => {
    const badgeUrl = "https://ext.cdn.kick.com/chat/badges/subscriber.png";
    window.__STREAMFUSION_BROWSER_DEV_CLIENT__ = true;
    try {
      expect(resolveProxiedImageSrc(badgeUrl)).toMatch(
        /^\/__streamfusion-dev\/media\?.*kind=kick-image/
      );
    } finally {
      delete window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
    }

    expect(resolveProxiedImageSrc(badgeUrl)).toMatch(/^kick-image:\/\/image\?u=/);
  });
});
