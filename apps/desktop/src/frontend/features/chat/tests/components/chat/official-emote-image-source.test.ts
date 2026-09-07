import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";

import {
  getSevenTvIpv4FallbackUrl,
  useOfficialEmoteImageSource,
} from "@/features/chat/components/chat/official-emote-image-source";

function imageEvent(sourceUrl: string) {
  return {
    currentTarget: {
      getAttribute: (name: string) => (name === "src" ? sourceUrl : null),
    },
  } as React.SyntheticEvent<HTMLImageElement>;
}

// Guards: only canonical secure 7TV CDN URLs may move to the validated official IPv4 edge; lookalikes and repeat fallbacks must never be rewritten
describe("getSevenTvIpv4FallbackUrl", () => {
  it("preserves the exact emote path, format, encoded query, and fragment", () => {
    expect(
      getSevenTvIpv4FallbackUrl(
        "https://cdn.7tv.app/emote/a%2Fb/4x.avif?quality=90&name=a%20b#preview"
      )
    ).toBe("https://ipv4-1.eu.cdn.7tv.app/emote/a%2Fb/4x.avif?quality=90&name=a%20b#preview");
  });

  it.each([
    "https://ipv4-1.eu.cdn.7tv.app/emote/id/2x.webp",
    "https://cdn.7tv.app.evil.example/emote/id/2x.webp",
    "https://7tv.app/emote/id/2x.webp",
    "http://cdn.7tv.app/emote/id/2x.webp",
    "https://cdn.7tv.app:444/emote/id/2x.webp",
    "https://user@cdn.7tv.app/emote/id/2x.webp",
    "not a URL",
  ])("does not rewrite an untrusted or already-fallback URL: %s", (url) => {
    expect(getSevenTvIpv4FallbackUrl(url)).toBeNull();
  });

  it("ignores a duplicate stale error after moving the same attempt to the fallback", () => {
    const originalUrl = "https://cdn.7tv.app/emote/dedupe/2x.webp";
    const fallbackUrl = "https://ipv4-1.eu.cdn.7tv.app/emote/dedupe/2x.webp";
    const hook = renderHook(() => useOfficialEmoteImageSource(originalUrl));

    act(() => hook.result.current.handleError(imageEvent(originalUrl)));
    expect(hook.result.current.sourceUrl).toBe(fallbackUrl);
    expect(hook.result.current.failed).toBe(false);

    act(() => hook.result.current.handleError(imageEvent(originalUrl)));
    expect(hook.result.current.sourceUrl).toBe(fallbackUrl);
    expect(hook.result.current.failed).toBe(false);

    act(() => hook.result.current.handleError(imageEvent(fallbackUrl)));
    expect(hook.result.current.failed).toBe(true);
  });
});
