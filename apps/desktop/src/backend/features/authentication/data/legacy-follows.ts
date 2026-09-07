import type { LocalFollow } from "@shared/auth-types";
export function normalizeLegacyLocalFollows(value: unknown): LocalFollow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const record = candidate as Record<string, unknown>;
    const platform = record.platform;
    const channelName = typeof record.channelName === "string" ? record.channelName.trim() : "";
    const channelId =
      typeof record.channelId === "string" && record.channelId.trim().length > 0
        ? record.channelId.trim()
        : channelName;
    if ((platform !== "kick" && platform !== "twitch") || !channelName || !channelId) {
      return [];
    }
    const storedSource =
      record.source === "guest" || record.source === "kick" || record.source === "twitch"
        ? record.source
        : "guest";
    const source = storedSource === "guest" || storedSource === platform ? storedSource : "guest";
    return [
      {
        id:
          typeof record.id === "string" && record.id.length > 0
            ? record.id
            : `${platform}-legacy-${channelId.toLowerCase()}-${index}`,
        platform,
        channelId,
        channelName,
        displayName: typeof record.displayName === "string" ? record.displayName : channelName,
        profileImage: typeof record.profileImage === "string" ? record.profileImage : "",
        followedAt:
          typeof record.followedAt === "string" ? record.followedAt : "1970-01-01T00:00:00.000Z",
        source,
      },
    ];
  });
}
