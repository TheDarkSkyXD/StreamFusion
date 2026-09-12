import type {
  SignedOutCategoriesBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

import type {
  AppCredentials,
  DiscoveryCatalog
} from "../capabilities/discovery-catalog";

type TwitchStream = SignedOutTopStreamsBody["streams"][number];
type TwitchCategory = SignedOutCategoriesBody["categories"][number];
type TwitchChannel = SignedOutSearchBody["channels"][number];
type JsonRecord = Record<string, unknown>;

type CachedToken = {
  readonly expiresAtEpochMs: number;
  readonly value: string;
};

const TWITCH_IDENTITY_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_URL = "https://api.twitch.tv/helix";

export function createTwitchHelixCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): DiscoveryCatalog {
  const client = createTwitchClient(input);
  return {
    platform: "twitch",
    async topStreams() {
      const payload = await client.get("/streams?first=20");
      return payload === null ? null : topStreamsBody(payload);
    },
    async categories() {
      const payload = await client.get("/games/top?first=20");
      return payload === null ? null : categoriesBody(payload);
    },
    async search({ query }) {
      const [channels, categories] = await Promise.all([
        client.get(`/search/channels?${queryParams({ first: "20", query })}`),
        client.get(`/search/categories?${queryParams({ first: "20", query })}`)
      ]);
      return searchBody(channels, categories, query);
    }
  };
}

function createTwitchClient(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}) {
  let cachedToken: CachedToken | null = null;
  const now = input.now ?? Date.now;

  async function token(): Promise<string | null> {
    if (input.credentials === null) return null;
    if (cachedToken !== null && now() < cachedToken.expiresAtEpochMs)
      return cachedToken.value;
    const payload = await clientCredentialsToken(
      input.fetch,
      input.credentials
    );
    if (payload === null) return null;
    cachedToken = {
      expiresAtEpochMs: now() + payload.expiresInSeconds * 1_000,
      value: payload.value
    };
    return cachedToken.value;
  }

  return {
    async get(path: string): Promise<unknown | null> {
      const accessToken = await token();
      if (accessToken === null || input.credentials === null) return null;
      try {
        const response = await input.fetch(`${TWITCH_HELIX_URL}${path}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Client-Id": input.credentials.clientId
          }
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        return payload;
      } catch {
        return null;
      }
    }
  };
}

async function clientCredentialsToken(
  fetch: typeof globalThis.fetch,
  credentials: AppCredentials
): Promise<{
  readonly value: string;
  readonly expiresInSeconds: number;
} | null> {
  try {
    const response = await fetch(TWITCH_IDENTITY_URL, {
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "client_credentials"
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return tokenResponse(payload);
  } catch {
    return null;
  }
}

function tokenResponse(
  value: unknown
): { readonly value: string; readonly expiresInSeconds: number } | null {
  if (!isRecord(value)) return null;
  const token = value.access_token;
  const expiresIn = value.expires_in;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return null;
  }
  return { expiresInSeconds: expiresIn, value: token };
}

function topStreamsBody(payload: unknown): SignedOutTopStreamsBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutTopStreamsBody = {
    platform: "twitch",
    streams: dataFrom(payload).map(toStream)
  };
  return cursor === null ? body : { ...body, cursor };
}

function categoriesBody(payload: unknown): SignedOutCategoriesBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutCategoriesBody = {
    categories: dataFrom(payload).map(toCategory),
    platform: "twitch" as const
  };
  return cursor === null ? body : { ...body, cursor };
}

function searchBody(
  channelsPayload: unknown | null,
  categoriesPayload: unknown | null,
  query: string
): SignedOutSearchBody | null {
  if (channelsPayload === null || categoriesPayload === null) return null;
  return {
    categories: dataFrom(categoriesPayload).map(toCategory),
    channels: dataFrom(channelsPayload).map(toChannel),
    platform: "twitch",
    query,
    streams: []
  };
}

function toStream(record: JsonRecord): TwitchStream {
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    channelAvatar: "",
    channelDisplayName: firstString(record, ["user_name", "user_login"]),
    channelId: identifierAt(record, "user_id"),
    channelName: firstString(record, ["user_login", "user_name"]),
    id: identifierAt(record, "id"),
    isLive: stringAt(record, "type") === "live",
    language: stringAt(record, "language"),
    platform: "twitch",
    startedAt: null,
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: stringAt(record, "thumbnail_url")
      .replaceAll("{width}", "640")
      .replaceAll("{height}", "360"),
    title: stringAt(record, "title"),
    viewerCount: nonNegativeNumberAt(record, "viewer_count"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function toCategory(record: JsonRecord): TwitchCategory {
  return {
    boxArtUrl: stringAt(record, "box_art_url")
      .replaceAll("{width}", "285")
      .replaceAll("{height}", "380"),
    id: identifierAt(record, "id"),
    name: stringAt(record, "name"),
    platform: "twitch"
  };
}

function toChannel(record: JsonRecord): TwitchChannel {
  const categoryId = stringAt(record, "game_id");
  const categoryName = stringAt(record, "game_name");
  return {
    avatarUrl: stringAt(record, "thumbnail_url"),
    displayName: firstString(record, ["display_name", "broadcaster_login"]),
    id: identifierAt(record, "id"),
    isLive: booleanAt(record, "is_live"),
    isPartner: stringAt(record, "broadcaster_type") === "partner",
    isVerified: false,
    platform: "twitch",
    username: stringAt(record, "broadcaster_login"),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}

function dataFrom(value: unknown): JsonRecord[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

function cursorFrom(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.pagination)) return null;
  const cursor = value.pagination.cursor;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 512
    ? cursor
    : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function identifierAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? `${value}`
      : "";
}

function firstString(record: JsonRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringAt(record, key);
    if (value !== "") return value;
  }
  return "";
}

function nonNegativeNumberAt(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function booleanAt(record: JsonRecord, key: string): boolean {
  return record[key] === true;
}

function stringArrayAt(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function queryParams(input: Record<string, string>): string {
  return new URLSearchParams(input).toString();
}
