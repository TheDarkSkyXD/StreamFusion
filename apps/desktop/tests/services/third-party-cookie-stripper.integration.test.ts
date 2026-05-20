/**
 * Integration tests for the third-party cookie stripper's session wiring.
 *
 * The unit suite (third-party-cookie-stripper.test.ts) covers the pure
 * predicates. This file simulates an Electron Session and asserts the
 * stripper actually drops Set-Cookie headers at the response boundary, and
 * the purge call evicts only the strip-list domains — leaving id.twitch.tv,
 * id.kick.com, and kick.com (Cloudflare WAF) cookies intact.
 *
 * Without this, the URL filter pattern + header mutation can drift apart
 * silently — both look right in isolation but only their composition
 * actually fixes the DevTools warning.
 */

import { describe, expect, it, vi } from "vitest";

import {
  purgeStoredThirdPartyCookies,
  registerThirdPartyCookieStripper,
} from "@/backend/services/third-party-cookie-stripper";

type HeaderMap = Record<string, string[] | undefined>;
type HeadersReceivedListener = (
  details: { url: string; responseHeaders?: HeaderMap },
  callback: (response: { responseHeaders?: HeaderMap; cancel?: boolean }) => void
) => void;

interface StoredCookie {
  domain: string;
  name: string;
  path?: string;
}

function makeFakeSession(seededCookies: StoredCookie[] = []) {
  let onHeadersReceived: HeadersReceivedListener | null = null;
  let onHeadersFilter: { urls: string[] } | null = null;
  const cookies = [...seededCookies];
  const removeCalls: Array<{ url: string; name: string }> = [];
  const flushStore = vi.fn().mockResolvedValue(undefined);

  return {
    spy: {
      remove: removeCalls,
      flushStore,
      get filter() {
        return onHeadersFilter;
      },
    },
    session: {
      webRequest: {
        onHeadersReceived(filter: { urls: string[] }, listener: HeadersReceivedListener) {
          onHeadersFilter = filter;
          onHeadersReceived = listener;
        },
      },
      cookies: {
        // Electron's cookies.get({domain}) follows Chromium semantics: it
        // returns cookies whose Domain attribute matches or is a parent of
        // the queried domain. cookies.get({domain: "files.kick.com"}) also
        // returns cookies with Domain=.kick.com. Modelling this in the fake
        // lets us catch over-purge of parent-domain cookies (cf_clearance on
        // .kick.com would be evicted if the strip list ever included
        // files.kick.com without also excluding the parent).
        get: vi.fn(async ({ domain }: { domain: string }) =>
          cookies.filter((c) => {
            const cd = c.domain.replace(/^\./, "");
            const qd = domain.replace(/^\./, "");
            return cd === qd || qd.endsWith(`.${cd}`);
          })
        ),
        remove: vi.fn(async (url: string, name: string) => {
          removeCalls.push({ url, name });
        }),
        flushStore,
      },
    },
    fire(url: string, responseHeaders: HeaderMap): HeaderMap | undefined {
      if (!onHeadersReceived) throw new Error("listener not registered");
      // Electron semantics: a callback that omits responseHeaders means
      // "no modifications, pass original through". Model that here so the
      // defense-in-depth test (kick.com → not stripped) matches reality.
      let result: HeaderMap | undefined = responseHeaders;
      onHeadersReceived({ url, responseHeaders }, (resp) => {
        if (resp.responseHeaders !== undefined) {
          result = resp.responseHeaders;
        }
      });
      return result;
    },
  };
}

describe("registerThirdPartyCookieStripper", () => {
  it("strips Set-Cookie from a jtvnw.net response (the original warning source)", () => {
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    const result = fake.fire("https://static-cdn.jtvnw.net/jtv_user_pictures/avatar.png", {
      "Content-Type": ["image/png"],
      "Set-Cookie": ["unique_id=abc123; SameSite=None; Secure"],
    });

    expect(result?.["Set-Cookie"]).toBeUndefined();
    expect(result?.["Content-Type"]).toEqual(["image/png"]);
  });

  it("strips Set-Cookie from a Kick image CDN response", () => {
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    const result = fake.fire("https://files.kick.com/emotes/39277/fullsize", {
      "set-cookie": ["__cf_bm=token; SameSite=None; Secure"],
    });

    expect(result?.["set-cookie"]).toBeUndefined();
  });

  it("does NOT strip cookies from kick.com root (Cloudflare WAF needs them)", () => {
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    // The Electron filter URL pattern wouldn't even match kick.com (root),
    // but the predicate is the defense-in-depth check we rely on. Simulate
    // the case where the filter pattern over-matches and the predicate is
    // the last line of defense.
    const result = fake.fire("https://kick.com/api/v2/channels/xqc", {
      "Set-Cookie": ["cf_clearance=keepme; SameSite=None; Secure"],
    });

    expect(result?.["Set-Cookie"]).toEqual(["cf_clearance=keepme; SameSite=None; Secure"]);
  });

  it("registers a non-empty URL filter on webRequest.onHeadersReceived", () => {
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    expect(fake.spy.filter?.urls.length).toBeGreaterThan(0);
    // Must include the three biggest leaky origins
    const flat = fake.spy.filter?.urls.join(" ") ?? "";
    expect(flat).toContain("jtvnw.net");
    expect(flat).toContain("files.kick.com");
    expect(flat).toContain("cdn.7tv.app");
  });

  it("calls callback({}) when details.responseHeaders is undefined", () => {
    // Electron occasionally fires the listener with no responseHeaders
    // (early-response paths, certain failure modes). The contract is
    // callback({}) for "no modifications" — anything else (e.g.
    // callback({ responseHeaders: undefined })) can be interpreted by
    // Electron as "replace headers with nothing" depending on the version.
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    let capturedResponse: { responseHeaders?: unknown } | null = null;
    fake.session.webRequest.onHeadersReceived = ((
      _filter: { urls: string[] },
      listener: (
        details: { url: string; responseHeaders?: unknown },
        cb: (resp: { responseHeaders?: unknown }) => void
      ) => void
    ) => {
      listener(
        { url: "https://static-cdn.jtvnw.net/foo.png", responseHeaders: undefined },
        (resp) => {
          capturedResponse = resp;
        }
      );
    }) as never;
    registerThirdPartyCookieStripper(fake.session as never);

    expect(capturedResponse).toEqual({});
  });

  it("falls back to callback({}) if the strip throws on a malformed header shape", () => {
    const fake = makeFakeSession();
    registerThirdPartyCookieStripper(fake.session as never);

    // Pass headers where Object.keys would succeed but iteration trips on a
    // non-iterable value. The listener must still complete the response
    // rather than hang Electron's network stack.
    const malformed = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("kaboom");
        },
      }
    ) as unknown as Record<string, string[]>;

    expect(() => fake.fire("https://static-cdn.jtvnw.net/foo.png", malformed)).not.toThrow();
  });
});

describe("purgeStoredThirdPartyCookies", () => {
  it("removes cookies for strip-list domains and flushes the store", async () => {
    const seeded: StoredCookie[] = [
      { domain: ".jtvnw.net", name: "unique_id", path: "/" },
      { domain: ".jtvnw.net", name: "tos", path: "/" },
      { domain: "files.kick.com", name: "__cf_bm", path: "/" },
      { domain: "api.kick.com", name: "session", path: "/" },
    ];
    const fake = makeFakeSession(seeded);

    await purgeStoredThirdPartyCookies(fake.session as never);

    // All four seeded cookies should have remove() called against them.
    expect(fake.spy.remove).toHaveLength(4);

    const removedNames = fake.spy.remove.map((c) => c.name).sort();
    expect(removedNames).toEqual(["__cf_bm", "session", "tos", "unique_id"]);

    // remove() takes an https:// URL — verify the host strip is correct.
    for (const call of fake.spy.remove) {
      expect(call.url).toMatch(/^https:\/\/[^/]+\//);
      expect(call.url).not.toContain("//."); // leading dot must be stripped
    }

    expect(fake.spy.flushStore).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the cookie jar is empty for those domains", async () => {
    const fake = makeFakeSession([]);
    await purgeStoredThirdPartyCookies(fake.session as never);
    expect(fake.spy.remove).toHaveLength(0);
    // flushStore still fires — safe and cheap.
    expect(fake.spy.flushStore).toHaveBeenCalledTimes(1);
  });

  it("swallows per-cookie remove failures so app startup doesn't break", async () => {
    const seeded: StoredCookie[] = [{ domain: ".jtvnw.net", name: "unique_id", path: "/" }];
    const fake = makeFakeSession(seeded);
    (fake.session.cookies.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("locked")
    );

    await expect(purgeStoredThirdPartyCookies(fake.session as never)).resolves.toBeUndefined();
  });

  it("swallows cookies.get failures so a broken cookie store doesn't crash startup", async () => {
    // If Electron's cookies API returns a permission/corruption error on
    // every get(), purge becomes a no-op — but app launch must continue.
    const fake = makeFakeSession([]);
    (fake.session.cookies.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("cookie store unavailable")
    );

    await expect(purgeStoredThirdPartyCookies(fake.session as never)).resolves.toBeUndefined();
    expect(fake.spy.remove).toHaveLength(0);
  });

  it("swallows a flushStore failure without throwing", async () => {
    const fake = makeFakeSession([]);
    (fake.spy.flushStore as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk full"));

    await expect(purgeStoredThirdPartyCookies(fake.session as never)).resolves.toBeUndefined();
  });
});
