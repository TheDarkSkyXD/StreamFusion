import type { Platform } from "@/shared/auth-types";

type RendererMediaKind = "clip" | "video";

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isAllowedKickHost(hostname: string): boolean {
  return (
    isHostOrSubdomain(hostname, "kick.com") ||
    isHostOrSubdomain(hostname, "playback.live-video.net")
  );
}

function hasAllowedMediaPath(pathname: string, kind: RendererMediaKind): boolean {
  const normalizedPath = pathname.toLowerCase();
  return kind === "video"
    ? normalizedPath.endsWith(".m3u8")
    : normalizedPath.endsWith(".m3u8") || normalizedPath.endsWith(".mp4");
}

export function assertAllowedRendererMediaUrl({
  platform,
  kind,
  url,
}: {
  platform: Platform;
  kind: RendererMediaKind;
  url: string;
}): string {
  if (platform === "twitch") {
    throw new Error("Twitch media must be freshly resolved by the main process");
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      !isAllowedKickHost(parsed.hostname) ||
      !hasAllowedMediaPath(parsed.pathname, kind)
    ) {
      throw new Error("invalid source");
    }
    return parsed.href;
  } catch {
    throw new Error(`Untrusted Kick ${kind} media URL`);
  }
}
