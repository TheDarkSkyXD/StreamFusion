/**
 * Thin Twitch global chat-badge catalog for Watch guest chat.
 * Mirrors desktop BadgeResolver's anonymous GQL `Badges` path so artwork
 * comes from Twitch's catalog (including lead_moderator) rather than hardcoded CDN URLs.
 */

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type TwitchBadgeRef = {
  readonly setId: string;
  readonly version: string;
};

export type ResolvedTwitchBadge = {
  readonly setId: string;
  readonly version: string;
  readonly imageUrl: string;
  readonly title: string;
};

type CatalogEntry = {
  readonly imageUrl: string;
  readonly title: string;
};

let cache: Map<string, CatalogEntry> | null = null;
let loadedAt = 0;
let inflight: Promise<Map<string, CatalogEntry>> | null = null;

function cacheKey(setId: string, version: string): string {
  return `${setId}:${version}`;
}

export function resetTwitchGlobalBadgeCatalogForTests(): void {
  cache = null;
  loadedAt = 0;
  inflight = null;
}

export async function ensureTwitchGlobalBadgeCatalog(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  if (cache && Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (inflight) {
    await inflight;
    return;
  }
  inflight = loadCatalog(fetchImpl).finally(() => {
    inflight = null;
  });
  cache = await inflight;
  loadedAt = Date.now();
}

async function loadCatalog(
  fetchImpl: typeof globalThis.fetch,
): Promise<Map<string, CatalogEntry>> {
  const response = await fetchImpl(TWITCH_GQL_URL, {
    body: JSON.stringify({
      operationName: "Badges",
      query: `query Badges($quality: BadgeImageSize) {
        badges {
          imageURL(size: $quality)
          setID
          title
          version
        }
      }`,
      variables: { quality: "QUADRUPLE" },
    }),
    headers: {
      "Client-Id": TWITCH_GQL_CLIENT_ID,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Twitch badge GQL error: ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: {
      badges?: Array<{
        imageURL?: string | null;
        setID?: string | null;
        title?: string | null;
        version?: string | null;
      } | null>;
    };
  };
  const next = new Map<string, CatalogEntry>();
  for (const badge of payload.data?.badges ?? []) {
    if (!badge?.setID || !badge.version || !badge.imageURL) continue;
    if (!isHttpsUrl(badge.imageURL)) continue;
    next.set(cacheKey(badge.setID, badge.version), {
      imageUrl: badge.imageURL,
      title: badge.title ?? badge.setID,
    });
  }
  if (next.size === 0) {
    throw new Error("Twitch badge GQL returned no usable badges");
  }
  return next;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveTwitchBadges(
  refs: readonly TwitchBadgeRef[],
): readonly ResolvedTwitchBadge[] {
  if (refs.length === 0) return [];
  const catalog = cache;
  return refs.map((ref) => {
    const hit = catalog?.get(cacheKey(ref.setId, ref.version));
    return {
      setId: ref.setId,
      version: ref.version,
      imageUrl: hit?.imageUrl ?? "",
      title: hit?.title ?? ref.setId,
    };
  });
}
