import type { WatchChatBadge } from "../capabilities/watch-chat";
import type { WatchChatBadgeCatalog } from "../capabilities/chat-badge-catalog";

export type KickBadgeArtwork = (
  type: string,
  count: number | undefined,
) => string | undefined;

export function parseKickIdentityBadges(
  value: unknown,
  artwork: KickBadgeArtwork,
): readonly WatchChatBadge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const rawType = field(raw, "type");
    if (typeof rawType !== "string" || !rawType.trim()) return [];
    const type = rawType.toLowerCase().replace(/[-\s]/g, "_");
    const rawCount = field(raw, "count");
    const count =
      typeof rawCount === "number" &&
      Number.isInteger(rawCount) &&
      rawCount >= 0
        ? rawCount
        : undefined;
    const explicitImage =
      safeImageUrl(field(raw, "imageUrl")) ??
      safeImageUrl(field(raw, "image_url")) ??
      safeImageUrl(field(field(raw, "badge_image"), "src"));
    const imageUrl = explicitImage ?? artwork(type, count);
    if (!imageUrl) return [];
    const rawTitle = field(raw, "text");
    const title =
      type === "subscriber" && count !== undefined && count > 0
        ? `${count}-Month Subscriber`
        : (type === "sub_gifter" || type === "subgifter") &&
            count !== undefined &&
            count > 0
          ? `Gifted ${count} ${count === 1 ? "sub" : "subs"}`
          : typeof rawTitle === "string" && rawTitle.trim()
            ? rawTitle
            : rawType;
    return [
      { setId: type, version: count?.toString() ?? "1", title, imageUrl },
    ];
  });
}

export function parseKickSubscriberCatalog(
  value: unknown,
): WatchChatBadgeCatalog {
  const entries = field(value, "subscriber_badges");
  const subscribers = new Map<string, WatchChatBadge>();
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const months = field(entry, "months");
      const imageUrl = safeImageUrl(field(field(entry, "badge_image"), "src"));
      if (
        typeof months !== "number" ||
        !Number.isInteger(months) ||
        months < 1 ||
        !imageUrl
      )
        continue;
      subscribers.set(String(months), {
        setId: "subscriber",
        version: String(months),
        imageUrl,
        title: `${months}-Month Subscriber`,
      });
    }
  }
  return subscribers.size ? new Map([["subscriber", subscribers]]) : new Map();
}

export function resolveKickChatBadges(
  badges: readonly WatchChatBadge[],
  catalog: WatchChatBadgeCatalog,
): readonly WatchChatBadge[] {
  const tiers = catalog.get("subscriber");
  if (!tiers?.size) return badges;
  return badges.map((badge) => {
    if (badge.setId !== "subscriber") return badge;
    const months = Number(badge.version);
    if (!Number.isFinite(months) || months < 0) return badge;
    let chosen: WatchChatBadge | undefined;
    let highest = -1;
    for (const [threshold, candidate] of tiers) {
      const tier = Number(threshold);
      if (Number.isInteger(tier) && tier <= months && tier > highest) {
        highest = tier;
        chosen = candidate;
      }
    }
    return chosen ? { ...badge, imageUrl: chosen.imageUrl } : badge;
  });
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Reflect.get(value, key);
}

function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
