/**
 * Tests for third-party cookie stripper.
 *
 * Regression test for the 1801 "Reading cookie in cross-site context" DevTools
 * warnings. The original filter in main.ts only covered *.twitch.tv and
 * *.ttvnw.net, so Set-Cookie from static-cdn.jtvnw.net, files.kick.com, and
 * emote CDNs slipped through and accumulated in the renderer's cookie jar.
 */

import { describe, expect, it } from "vitest";

import {
  shouldStripSetCookieForUrl,
  stripSetCookieFromHeaders,
  THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS,
} from "@/backend/services/third-party-cookie-stripper";

describe("third-party-cookie-stripper", () => {
  describe("shouldStripSetCookieForUrl", () => {
    it.each([
      // The original DevTools warning source — Twitch CDN
      "https://static-cdn.jtvnw.net/jtv_user_pictures/avatar.png",
      "https://static-cdn.jtvnw.net/user-default-pictures-uv/foo.png",
      // Twitch GQL / Helix already covered by the original strip
      "https://gql.twitch.tv/gql",
      "https://api.twitch.tv/helix/streams",
      // HLS segments
      "https://video-weaver.fra02.hls.ttvnw.net/v1/segment/foo.ts",
      "https://usher.ttvnw.net/api/channel/hls/foo.m3u8",
      // Kick image CDN
      "https://files.kick.com/emotes/39277/fullsize",
      "https://images.kick.com/foo.png",
      // Emote CDNs — these are pure static and never need cookies
      "https://cdn.7tv.app/emote/123/2x.webp",
      "https://cdn.betterttv.net/emote/abc/2x.webp",
      "https://cdn.frankerfacez.com/emote/456/2",
      "https://cdn.kicktalk.app/global/foo.webp",
    ])("strips Set-Cookie from %s", (url) => {
      expect(shouldStripSetCookieForUrl(url)).toBe(true);
    });

    it.each([
      // OAuth flows depend on cookies — must not be stripped
      "https://id.twitch.tv/oauth2/authorize?client_id=foo",
      "https://id.kick.com/oauth/authorize?client_id=foo",
      // Cloudflare WAF clearance cookies on kick.com itself must survive so
      // the hidden BrowserWindow scraper in `persist:kick_public` can pass
      // the Cloudflare challenge gate.
      "https://kick.com/api/v2/channels/xqc",
      // Same origin / dev server — out of scope
      "http://localhost:5173/index.html",
      "https://fonts.googleapis.com/css",
    ])("does NOT strip Set-Cookie from %s", (url) => {
      expect(shouldStripSetCookieForUrl(url)).toBe(false);
    });
  });

  describe("URL patterns are valid Electron webRequest filters", () => {
    it("exposes a non-empty array of glob patterns", () => {
      expect(Array.isArray(THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS)).toBe(true);
      expect(THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS.length).toBeGreaterThan(0);
    });

    it("uses the *://host/* Electron glob shape", () => {
      for (const pattern of THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS) {
        expect(pattern).toMatch(/^\*:\/\/[^/]+\/\*$/);
      }
    });

    it("covers the jtvnw.net Twitch CDN (the largest warning source)", () => {
      const matchesJtvnw = THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS.some((p) =>
        p.includes("jtvnw.net")
      );
      expect(matchesJtvnw).toBe(true);
    });

    it("covers files.kick.com and images.kick.com", () => {
      const patterns = THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS.join(" ");
      expect(patterns).toContain("files.kick.com");
      expect(patterns).toContain("images.kick.com");
    });

    // Carve-outs: these hosts must NEVER appear in the URL-pattern layer.
    // The predicate has its own carve-outs but Electron applies the patterns
    // first — anything matched by a pattern enters the listener and is one
    // mistake away from being stripped. Locking the URL list is a stronger
    // guarantee than locking only the predicate.
    it.each([
      ["id.twitch.tv", "Twitch OAuth host"],
      ["id.kick.com", "Kick OAuth host"],
    ])("excludes %s (%s) from URL patterns", (host) => {
      for (const pattern of THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS) {
        expect(pattern).not.toContain(host);
      }
    });

    it("excludes the root kick.com host (Cloudflare WAF clearance lives here)", () => {
      // *://kick.com/* would strip cf_clearance and break the
      // persist:kick_public Cloudflare scraper. Subdomain patterns like
      // *://*.kick.com/* are also forbidden — they'd over-match kick.com root
      // (Electron's webRequest globs treat *.host as host + subdomains).
      for (const pattern of THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS) {
        expect(pattern).not.toBe("*://kick.com/*");
        expect(pattern).not.toBe("*://*.kick.com/*");
      }
    });
  });

  describe("stripSetCookieFromHeaders", () => {
    it("removes Set-Cookie regardless of casing", () => {
      const result = stripSetCookieFromHeaders({
        "Content-Type": ["image/png"],
        "Set-Cookie": ["foo=1; SameSite=None; Secure"],
      });
      expect(result["Set-Cookie"]).toBeUndefined();
      expect(result["Content-Type"]).toEqual(["image/png"]);
    });

    it("removes set-cookie (lowercase) too", () => {
      const result = stripSetCookieFromHeaders({
        "content-type": ["image/png"],
        "set-cookie": ["foo=1"],
      });
      expect(result["set-cookie"]).toBeUndefined();
    });

    it("returns a new object — input is not mutated", () => {
      const input = {
        "Set-Cookie": ["foo=1"],
        "Content-Type": ["image/png"],
      };
      const result = stripSetCookieFromHeaders(input);
      expect(input["Set-Cookie"]).toEqual(["foo=1"]);
      expect(result["Set-Cookie"]).toBeUndefined();
    });

    it("handles headers with no Set-Cookie gracefully", () => {
      const result = stripSetCookieFromHeaders({
        "Content-Type": ["image/png"],
      });
      expect(result).toEqual({ "Content-Type": ["image/png"] });
    });

    it("removes multi-valued Set-Cookie arrays in full", () => {
      // Cloudflare and Twitch routinely set 2-3 cookies on a single response.
      // Electron exposes those as a string[] under one header key; stripping
      // means dropping the whole array, not the first entry.
      const result = stripSetCookieFromHeaders({
        "Content-Type": ["image/png"],
        "Set-Cookie": [
          "unique_id=abc; Domain=.twitch.tv; SameSite=None; Secure",
          "tos=1; Domain=.twitch.tv; SameSite=None; Secure",
          "server_session_id=zzz; Domain=.twitch.tv; SameSite=None; Secure",
        ],
      });
      expect(result["Set-Cookie"]).toBeUndefined();
    });
  });
});
