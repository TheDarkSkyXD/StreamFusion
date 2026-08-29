import type { Emote } from "@backend/services/emotes/emote-types";
import type { ChatCosmeticBadge, ChatCosmeticProvider } from "@shared/chat-types";

const svgDataUrl = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`
  )}`;

function previewEmote(
  id: string,
  name: string,
  provider: "7tv" | "bttv" | "ffz",
  body: string
): Emote {
  const url = svgDataUrl(body);
  return {
    id,
    name,
    provider,
    isGlobal: true,
    isAnimated: false,
    isZeroWidth: false,
    urls: { url1x: url, url2x: url, url4x: url },
  };
}

export const CHAT_PREVIEW_FALLBACK_EMOTES: Record<"7tv" | "bttv" | "ffz", Emote> = {
  "7tv": previewEmote(
    "settings-preview-7tv",
    "WaveTime",
    "7tv",
    '<defs><linearGradient id="g" x1="8" y1="8" x2="56" y2="56"><stop stop-color="#58d8ff"/><stop offset="1" stop-color="#5865f2"/></linearGradient></defs><path d="M11 17c7-10 35-10 42 0 6 8 5 28-2 36-8 8-30 8-38 0-7-8-8-28-2-36Z" fill="url(#g)"/><ellipse cx="23" cy="29" rx="6" ry="8" fill="#f7fbff"/><ellipse cx="42" cy="29" rx="6" ry="8" fill="#f7fbff"/><circle cx="25" cy="31" r="3" fill="#15223a"/><circle cx="40" cy="31" r="3" fill="#15223a"/><path d="M21 43c7 7 15 7 22 0" fill="none" stroke="#f7fbff" stroke-width="5" stroke-linecap="round"/>'
  ),
  bttv: previewEmote(
    "settings-preview-bttv",
    "CoolChat",
    "bttv",
    '<rect x="7" y="8" width="50" height="48" rx="18" fill="#8b5cf6"/><path d="M15 26h16l-2 10H18l-3-10Zm18 0h16l-3 10H35l-2-10Z" fill="#17171b"/><path d="M29 29h5" stroke="#17171b" stroke-width="4"/><path d="M22 44c7 5 13 5 20 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="17" cy="17" r="4" fill="#c4b5fd"/>'
  ),
  ffz: previewEmote(
    "settings-preview-ffz",
    "FoxJam",
    "ffz",
    '<path d="m8 17 13 5c7-4 15-4 22 0l13-5-5 15c3 14-5 24-19 24S10 46 13 32L8 17Z" fill="#f59e0b"/><path d="m17 24 9 5-10 3 1-8Zm30 0-9 5 10 3-1-8Z" fill="#fff3d1"/><circle cx="23" cy="34" r="3" fill="#2b2118"/><circle cx="41" cy="34" r="3" fill="#2b2118"/><path d="m32 38 4 4-4 4-4-4 4-4Z" fill="#2b2118"/><path d="M25 48c5 3 9 3 14 0" fill="none" stroke="#fff3d1" stroke-width="3" stroke-linecap="round"/>'
  ),
};

const badgeArtwork: Record<ChatCosmeticProvider, string> = {
  "7tv":
    '<defs><linearGradient id="g" x1="12" y1="8" x2="52" y2="56"><stop stop-color="#a970ff"/><stop offset="1" stop-color="#5865f2"/></linearGradient></defs><path d="m32 6 22 12-4 27-18 13-18-13-4-27L32 6Z" fill="url(#g)"/><path d="m32 17 4 9 10 1-8 7 3 10-9-5-9 5 3-10-8-7 10-1 4-9Z" fill="#fff"/>',
  bttv: '<path d="M9 11h46v31L32 57 9 42V11Z" fill="#8b5cf6"/><path d="M18 21h28v8H18v-8Zm4 12h20v8H22v-8Z" fill="#fff"/><circle cx="15" cy="16" r="4" fill="#c4b5fd"/>',
  ffz: '<path d="m32 7 8 13 15-2-6 14 8 12-15 2-10 11-10-11-15-2 8-12-6-14 15 2 8-13Z" fill="#f59e0b"/><path d="m21 27 7 4-7 4v-8Zm22 0v8l-7-4 7-4Zm-15 13h8" fill="#fff7e6" stroke="#fff7e6" stroke-width="3" stroke-linecap="round"/>',
};

export const CHAT_PREVIEW_FALLBACK_BADGES: Record<ChatCosmeticProvider, ChatCosmeticBadge> =
  Object.fromEntries(
    (Object.keys(badgeArtwork) as ChatCosmeticProvider[]).map((provider) => [
      provider,
      {
        id: `settings-preview-${provider}`,
        provider,
        providerId: `settings-preview-${provider}`,
        title: `${provider === "7tv" ? "7TV" : provider === "bttv" ? "BetterTTV" : "FrankerFaceZ"} profile badge`,
        imageUrl: svgDataUrl(badgeArtwork[provider]),
      },
    ])
  ) as Record<ChatCosmeticProvider, ChatCosmeticBadge>;

export const CHAT_PREVIEW_OVERLAY_EMOTE_URL = svgDataUrl(
  '<path d="m32 5 6 18 19-4-13 14 13 14-19-4-6 18-6-18-19 4 13-14L7 19l19 4 6-18Z" fill="#facc15"/><circle cx="32" cy="33" r="8" fill="#fff7c2"/><circle cx="29" cy="31" r="1.5" fill="#5b4210"/><circle cx="35" cy="31" r="1.5" fill="#5b4210"/><path d="M28 36c3 2 5 2 8 0" fill="none" stroke="#5b4210" stroke-width="2" stroke-linecap="round"/>'
);
