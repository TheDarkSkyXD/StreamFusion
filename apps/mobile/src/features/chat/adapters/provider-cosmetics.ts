import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
import type {
  ChatCosmeticBadge,
  ChatCosmeticRoleBadges,
  ChatCosmeticsReader,
  ChatPaintLayer,
  ChatPaintShadow,
  ChatPaintStop,
  ChatUserCosmetics,
  ChatUsernamePaint,
} from "../capabilities/chat-interactions";
import { array, identifier, object, string } from "../utils/provider-json";

const EMPTY: ChatUserCosmetics = { badges: [] };
const CACHE_MS = 10 * 60_000;
const MAX_USERS = 256;
const BATCH_SIZE = 5;

type BadgeIndex = ReadonlyMap<string, readonly ChatCosmeticBadge[]>;
type CacheEntry<T> = { readonly expiresAt: number; readonly value: Promise<T> };

function imageUrl(value: unknown): string {
  const url = string(value);
  if (url.startsWith("//")) return `https:${url}`;
  return url.startsWith("https://") ? url : "";
}

function preferredImage(
  images: unknown,
  preferredMime = "image/webp",
  animate = false,
): string {
  const choices = array(images).map(object);
  const matches = choices
    .filter(
      (entry) => string(entry.mime) === preferredMime && imageUrl(entry.url),
    )
    .sort((left, right) => {
      const scale =
        Math.abs(Number(left.scale) - 2) - Math.abs(Number(right.scale) - 2);
      if (scale) return scale;
      const staticDifference =
        Number(string(left.url).includes("_static.")) -
        Number(string(right.url).includes("_static."));
      return animate ? staticDifference : -staticDifference;
    });
  return imageUrl(
    matches[0]?.url ?? choices.find((entry) => imageUrl(entry.url))?.url,
  );
}

function rgba(raw: unknown): string {
  const color = object(raw);
  const channels = [color.r, color.g, color.b, color.a];
  if (
    channels.some(
      (channel) => typeof channel !== "number" || !Number.isFinite(channel),
    )
  )
    return "";
  const [r, g, b, a] = channels as number[];
  return `rgba(${Math.round(r ?? 0)}, ${Math.round(g ?? 0)}, ${Math.round(b ?? 0)}, ${Number(((a ?? 0) / 255).toFixed(3))})`;
}

function parseStops(raw: unknown): readonly ChatPaintStop[] {
  return array(raw).flatMap((value): ChatPaintStop[] => {
    const stop = object(value);
    const color = rgba(stop.color);
    return typeof stop.at === "number" && Number.isFinite(stop.at) && color
      ? [{ at: Math.max(0, Math.min(1, stop.at)), color }]
      : [];
  });
}

function parseShadows(raw: unknown): readonly ChatPaintShadow[] {
  return array(raw).flatMap((value): ChatPaintShadow[] => {
    const shadow = object(value);
    const color = rgba(shadow.color);
    return [shadow.offsetX, shadow.offsetY, shadow.blur].every(
      (number) => typeof number === "number" && Number.isFinite(number),
    ) && color
      ? [
          {
            xOffset: Number(shadow.offsetX),
            yOffset: Number(shadow.offsetY),
            radius: Number(shadow.blur),
            color,
          },
        ]
      : [];
  });
}

export function parseSevenTvUserCosmetics(raw: unknown): ChatUserCosmetics {
  const style = object(object(raw).style);
  const badge = object(style.activeBadge);
  const badgeUrl = preferredImage(badge.images, "image/png");
  const badges: ChatCosmeticBadge[] =
    string(badge.id) && badgeUrl
      ? [
          {
            id: `7tv:${badge.id}`,
            provider: "7tv",
            title: string(badge.name) || "7TV badge",
            imageUrl: badgeUrl,
          },
        ]
      : [];
  const activePaint = object(style.activePaint);
  const paintId = string(activePaint.id);
  if (!paintId) return { badges };
  const data = object(activePaint.data);
  const shadows = parseShadows(data.shadows);
  const layers = array(data.layers).flatMap((rawLayer): ChatPaintLayer[] => {
    const layer = object(rawLayer);
    const ty = object(layer.ty);
    const opacity =
      typeof layer.opacity === "number" && Number.isFinite(layer.opacity)
        ? Math.max(0, Math.min(1, layer.opacity))
        : 1;
    if (ty.__typename === "PaintLayerTypeImage") {
      const url = preferredImage(ty.images, "image/webp", true);
      return url ? [{ kind: "image", imageUrl: url, opacity }] : [];
    }
    if (ty.__typename === "PaintLayerTypeSingleColor") {
      const color = rgba(ty.color);
      return color
        ? [
            {
              kind: "linear",
              opacity,
              stops: [
                { at: 0, color },
                { at: 1, color },
              ],
            },
          ]
        : [];
    }
    const stops = parseStops(ty.stops);
    if (stops.length < 2) return [];
    if (ty.__typename === "PaintLayerTypeLinearGradient")
      return [
        {
          kind: "linear",
          opacity,
          stops,
          angle: Number(ty.angle) || 0,
          repeat: ty.repeating === true,
        },
      ];
    if (ty.__typename === "PaintLayerTypeRadialGradient")
      return [
        {
          kind: "radial",
          opacity,
          stops,
          shape: ty.shape === "ELLIPSE" ? "ellipse" : "circle",
          repeat: ty.repeating === true,
        },
      ];
    return [];
  });
  const paint: ChatUsernamePaint | undefined = layers.length
    ? { kind: "layers", id: paintId, layers, shadows }
    : undefined;
  return paint ? { badges, paint } : { badges };
}

export function parseBttvBadgeCatalog(raw: unknown): BadgeIndex {
  if (!Array.isArray(raw)) throw new Error("Invalid BTTV badge catalog.");
  const result = new Map<string, ChatCosmeticBadge[]>();
  for (const entry of raw) {
    const item = object(entry);
    const userId = identifier(item.providerId);
    const badge = object(item.badge);
    const url = imageUrl(badge.svg);
    if (!userId || !url) continue;
    const list = result.get(userId) ?? [];
    list.push({
      id: `bttv:${identifier(item.id) || userId}`,
      provider: "bttv",
      title: string(badge.description) || "BTTV badge",
      imageUrl: url,
    });
    result.set(userId, list);
  }
  return result;
}

export function parseFfzBadgeCatalog(raw: unknown): BadgeIndex {
  const catalog = object(raw);
  if (
    !Array.isArray(catalog.badges) ||
    typeof catalog.users !== "object" ||
    catalog.users === null
  )
    throw new Error("Invalid FFZ badge catalog.");
  const definitions = new Map<string, ChatCosmeticBadge>();
  for (const entry of array(catalog.badges)) {
    const badge = object(entry);
    const id = identifier(badge.id);
    const urls = object(badge.urls);
    const url = imageUrl(urls["4"] ?? urls["2"] ?? urls["1"]);
    if (!id || !url) continue;
    definitions.set(id, {
      id: `ffz:${id}`,
      provider: "ffz",
      title: string(badge.title) || "FFZ badge",
      imageUrl: url,
      ...(typeof badge.slot === "number" ? { slot: badge.slot } : {}),
      ...(typeof badge.replaces === "string"
        ? { replaces: badge.replaces }
        : {}),
      ...(typeof badge.color === "string" ? { color: badge.color } : {}),
    });
  }
  const result = new Map<string, ChatCosmeticBadge[]>();
  for (const [badgeId, users] of Object.entries(object(catalog.users))) {
    const badge = definitions.get(badgeId);
    if (!badge) continue;
    for (const rawId of array(users)) {
      const userId = identifier(rawId);
      if (!userId) continue;
      const list = result.get(userId) ?? [];
      list.push(badge);
      result.set(userId, list);
    }
  }
  return result;
}

export function parseFfzRoleBadges(raw: unknown): ChatCosmeticRoleBadges {
  const room = object(object(raw).room);
  const make = (
    role: "moderator" | "vip",
    rawUrls: unknown,
  ): ChatCosmeticBadge | undefined => {
    const urls = object(rawUrls);
    const url = imageUrl(urls["4"] ?? urls["2"] ?? urls["1"]);
    return url
      ? {
          id: `ffz:room-${role}`,
          provider: "ffz",
          title: `FFZ ${role}`,
          imageUrl: url,
          replaces: role,
        }
      : undefined;
  };
  return [make("moderator", room.mod_urls), make("vip", room.vip_badge)].filter(
    (badge): badge is ChatCosmeticBadge => badge !== undefined,
  );
}

const SEVEN_TV_STYLE = `style {
  activeBadge { id name images { url mime scale } }
  activePaint { id data {
    shadows { offsetX offsetY blur color { r g b a } }
    layers { opacity ty {
      __typename
      ... on PaintLayerTypeLinearGradient { angle repeating stops { at color { r g b a } } }
      ... on PaintLayerTypeRadialGradient { shape repeating stops { at color { r g b a } } }
      ... on PaintLayerTypeImage { images { url mime scale } }
      ... on PaintLayerTypeSingleColor { color { r g b a } }
    } }
  } }
}`;

export function createProviderCosmeticsReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly display?: Pick<ChatDisplaySettingsSession, "load">;
}): ChatCosmeticsReader {
  const catalogs = new Map<"bttv" | "ffz", CacheEntry<BadgeIndex>>();
  const rooms = new Map<string, CacheEntry<ChatCosmeticRoleBadges>>();
  const users = new Map<string, CacheEntry<ChatUserCosmetics>>();

  async function json(
    url: string,
    options?: RequestInit,
    notFoundIsEmpty = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await input.fetch(url, {
        ...options,
        signal: controller.signal,
      });
      if (response.status === 404 && notFoundIsEmpty) return null;
      if (!response.ok)
        throw new Error(`Cosmetic provider failed (${response.status}).`);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }

  function catalog(provider: "bttv" | "ffz"): Promise<BadgeIndex> {
    const cached = catalogs.get(provider);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value =
      provider === "bttv"
        ? json("https://api.betterttv.net/3/cached/badges/twitch").then(
            parseBttvBadgeCatalog,
          )
        : json("https://api.frankerfacez.com/v1/badges/ids").then(
            parseFfzBadgeCatalog,
          );
    catalogs.set(provider, { expiresAt: Date.now() + CACHE_MS, value });
    void value.catch(() => {
      if (catalogs.get(provider)?.value === value) catalogs.delete(provider);
    });
    return value;
  }

  function roleBadges(channel: string): Promise<ChatCosmeticRoleBadges> {
    const key = channel.toLowerCase();
    const cached = rooms.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = json(
      `https://api.frankerfacez.com/v1/room/${encodeURIComponent(key)}`,
      undefined,
      true,
    ).then(parseFfzRoleBadges);
    rooms.set(key, { expiresAt: Date.now() + CACHE_MS, value });
    void value.catch(() => {
      if (rooms.get(key)?.value === value) rooms.delete(key);
    });
    while (rooms.size > 16) rooms.delete(rooms.keys().next().value!);
    return value;
  }

  function queryUsers(
    platform: "TWITCH" | "KICK",
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, ChatUserCosmetics>> {
    const fields = ids
      .map(
        (id, index) =>
          `u${index}: userByConnection(platform: ${platform}, platformId: ${JSON.stringify(id)}) { ${SEVEN_TV_STYLE} }`,
      )
      .join(" ");
    return json("https://api.7tv.app/v4/gql", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: `query { users { ${fields} } }` }),
    }).then((raw) => {
      const response = object(raw);
      if (array(response.errors).length || !object(response.data).users)
        throw new Error("7TV cosmetic query failed.");
      const payload = object(object(response.data).users);
      const result = new Map<string, ChatUserCosmetics>();
      ids.forEach((id, index) =>
        result.set(id, parseSevenTvUserCosmetics(payload[`u${index}`])),
      );
      return result;
    });
  }

  function sevenTvUsers(
    platform: "TWITCH" | "KICK",
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, ChatUserCosmetics>> {
    const pending = ids.filter((id) => {
      const key = `${platform}:${id}`;
      const cached = users.get(key);
      if (!cached) return true;
      if (cached.expiresAt > Date.now()) return false;
      users.delete(key);
      return true;
    });
    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      const batch = pending.slice(start, start + BATCH_SIZE);
      const lookup = queryUsers(platform, batch);
      for (const id of batch) {
        const key = `${platform}:${id}`;
        const value = lookup.then((index) => index.get(id) ?? EMPTY);
        users.set(key, { expiresAt: Date.now() + CACHE_MS, value });
        void value.catch(() => {
          if (users.get(key)?.value === value) users.delete(key);
        });
      }
    }
    while (users.size > MAX_USERS) users.delete(users.keys().next().value!);
    return Promise.all(
      ids.map(
        async (id) =>
          [id, await users.get(`${platform}:${id}`)!.value] as const,
      ),
    ).then((entries) => new Map(entries));
  }

  return {
    async read(target, userIds, signal) {
      if (signal.aborted) return { byUserId: new Map(), failures: [] };
      const unique = [
        ...new Set(userIds.filter((id) => /^\d+$/.test(id))),
      ].slice(0, 120);
      const preferences = (await input.display?.load())?.preferences;
      if (signal.aborted) return { byUserId: new Map(), failures: [] };
      const enabled7tv =
        preferences?.enable7tvBadges !== false ||
        preferences?.enable7tvUsernamePaints !== false;
      const reads: {
        name: string;
        kind: "users" | "badges" | "roles";
        value: Promise<
          | BadgeIndex
          | ReadonlyMap<string, ChatUserCosmetics>
          | ChatCosmeticRoleBadges
        >;
      }[] = [];
      if (enabled7tv && unique.length)
        reads.push({
          name: "7TV",
          kind: "users",
          value: sevenTvUsers(
            target.platform === "twitch" ? "TWITCH" : "KICK",
            unique,
          ),
        });
      if (target.platform === "twitch") {
        if (preferences?.enableBttvBadges !== false)
          reads.push({ name: "BTTV", kind: "badges", value: catalog("bttv") });
        if (preferences?.enableFfzBadges !== false) {
          reads.push({ name: "FFZ", kind: "badges", value: catalog("ffz") });
          reads.push({
            name: "FFZ room",
            kind: "roles",
            value: roleBadges(target.channelName),
          });
        }
      }
      const settled = await Promise.allSettled(reads.map((read) => read.value));
      if (signal.aborted) return { byUserId: new Map(), failures: [] };
      const byUserId = new Map<string, ChatUserCosmetics>();
      const failures: string[] = [];
      let resolvedRoles: ChatCosmeticRoleBadges | undefined;
      settled.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push(reads[index]?.name ?? "Provider");
          return;
        }
        if (reads[index]?.kind === "roles") {
          resolvedRoles = result.value as ChatCosmeticRoleBadges;
          return;
        }
        const badgesByUser = result.value as
          BadgeIndex | ReadonlyMap<string, ChatUserCosmetics>;
        for (const id of unique) {
          const value = badgesByUser.get(id);
          if (!value) continue;
          const previous = byUserId.get(id) ?? EMPTY;
          if (reads[index]?.kind === "users") {
            const cosmetics = value as ChatUserCosmetics;
            byUserId.set(id, {
              badges: [...previous.badges, ...cosmetics.badges],
              ...(cosmetics.paint ? { paint: cosmetics.paint } : {}),
            });
          } else {
            const badges = value as readonly ChatCosmeticBadge[];
            byUserId.set(id, {
              ...previous,
              badges: [...previous.badges, ...badges],
            });
          }
        }
      });
      for (const id of unique) if (!byUserId.has(id)) byUserId.set(id, EMPTY);
      return {
        byUserId,
        ...(resolvedRoles ? { roleBadges: resolvedRoles } : {}),
        failures,
      };
    },
  };
}
