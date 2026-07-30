import type { Platform } from "../shared/auth-types";
import { buildDevBrowserMediaUrl } from "./dev-browser-media-url";

export const KICK_IMAGE_SCHEME = "kick-image";
export const TWITCH_IMAGE_SCHEME = "twitch-image";

const KICK_PROXY_DOMAINS = ["files.kick.com", "images.kick.com"];
const KICK_EXACT_PROXY_DOMAINS = new Set(["ext.cdn.kick.com"]);
const TWITCH_IMAGE_DOMAINS = ["static-cdn.jtvnw.net"];
const KICK_PROXY_PATTERNS = [/^https?:\/\/(www\.)?kick\.com\/img\//i];
const TWITCH_PROXY_PATTERNS = [/^https:\/\/static-cdn\.jtvnw\.net\/jtv_user_pictures\//i];
export const TWITCH_PREVIEW_PATTERN =
  /^https:\/\/static-cdn\.jtvnw\.net\/previews-ttv\/live_user_[^/?#]+-\d+x\d+\.jpg(?:[?#]|$)/i;

type ProxyScheme = typeof KICK_IMAGE_SCHEME | typeof TWITCH_IMAGE_SCHEME;

function matchesDomain(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function isAllowedPlatformImageUrl(src: string, platform: Platform): boolean {
  try {
    const parsed = new URL(src);
    if (parsed.protocol !== "https:") return false;
    if (platform === "twitch") return matchesDomain(parsed.hostname, TWITCH_IMAGE_DOMAINS);
    return (
      matchesDomain(parsed.hostname, KICK_PROXY_DOMAINS) ||
      KICK_EXACT_PROXY_DOMAINS.has(parsed.hostname) ||
      ((parsed.hostname === "kick.com" || parsed.hostname === "www.kick.com") &&
        parsed.pathname.startsWith("/img/"))
    );
  } catch {
    return false;
  }
}

function chooseProxy(url: string): ProxyScheme | null {
  try {
    const parsed = new URL(url);
    const kickDomainHit =
      matchesDomain(parsed.hostname, KICK_PROXY_DOMAINS) ||
      KICK_EXACT_PROXY_DOMAINS.has(parsed.hostname);
    if (kickDomainHit || KICK_PROXY_PATTERNS.some((pattern) => pattern.test(url))) {
      return KICK_IMAGE_SCHEME;
    }
    if (TWITCH_PROXY_PATTERNS.some((pattern) => pattern.test(url))) return TWITCH_IMAGE_SCHEME;
    return null;
  } catch {
    return null;
  }
}

function toBase64Url(value: string): string {
  const utf8 = String.fromCharCode(...new TextEncoder().encode(value));
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function resolveProxiedSrc(src: string, scheme: ProxyScheme): string {
  if (globalThis.window?.__STREAMFUSION_BROWSER_DEV_CLIENT__) {
    return buildDevBrowserMediaUrl(
      src,
      scheme === KICK_IMAGE_SCHEME ? "kick-image" : "twitch-image"
    );
  }
  return `${scheme}://image?u=${toBase64Url(src)}`;
}

export function resolveProxiedImageSrc(src: string | undefined | null): string | null {
  if (!src || src.trim() === "") return null;
  if (src.startsWith("data:")) return src;
  if (!src.startsWith("http")) return null;
  const scheme = chooseProxy(src);
  return scheme ? resolveProxiedSrc(src, scheme) : src;
}
