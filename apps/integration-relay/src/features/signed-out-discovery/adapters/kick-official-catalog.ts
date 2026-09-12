import type {
  SignedOutCategoriesBody,
  SignedOutSearchBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

import type {
  AppCredentials,
  DiscoveryCatalog
} from "../capabilities/discovery-catalog";
import { streamsFromLiveChannels } from "./live-streams-from-channels";

type KickStream = SignedOutTopStreamsBody["streams"][number];
type KickCategory = SignedOutCategoriesBody["categories"][number];
type KickChannel = SignedOutSearchBody["channels"][number];
type JsonRecord = Record<string, unknown>;
type CachedToken = {
  readonly expiresAtEpochMs: number;
  readonly value: string;
};

const KICK_IDENTITY_URL = "https://id.kick.com/oauth/token";
const KICK_API_URL = "https://api.kick.com";
export function createKickOfficialCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): DiscoveryCatalog {
  const client = createKickClient(input);
  return {
    platform: "kick",
    async topStreams() {
      const payload = await client.get("/public/v1/livestreams?limit=20");
      return payload === null ? null : topStreamsBody(payload);
    },
    async categories() {
      const payload = await client.get("/public/v2/categories?limit=20");
      return payload === null ? null : categoriesBody(payload);
    },
    async search({ query }) {
      const [channels, categories] = await Promise.all([
        client.get(`/public/v1/channels?${queryParams({ "slug[]": query })}`),
        client.get(`/public/v1/categories?${queryParams({ q: query })}`)
      ]);
      return searchBody(channels, categories, query);
    }
  };
}
function createKickClient(input: {
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
      if (accessToken === null) return null;
      try {
        const response = await input.fetch(`${KICK_API_URL}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
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
    const response = await fetch(KICK_IDENTITY_URL, {
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
    platform: "kick",
    streams: dataFrom(payload).map(toStream)
  };
  return cursor === null ? body : { ...body, cursor };
}
function categoriesBody(payload: unknown): SignedOutCategoriesBody {
  const cursor = cursorFrom(payload);
  const body: SignedOutCategoriesBody = {
    categories: dataFrom(payload).map(toCategory),
    platform: "kick"
  };
  return cursor === null ? body : { ...body, cursor };
}
function searchBody(
  channelsPayload: unknown | null,
  categoriesPayload: unknown | null,
  query: string
): SignedOutSearchBody | null {
  if (channelsPayload === null || categoriesPayload === null) return null;
  const channels = dataFrom(channelsPayload).map(toChannel);
  return {
    categories: dataFrom(categoriesPayload).map(toCategory),
    channels,
    clips: [],
    platform: "kick",
    query,
    streams: streamsFromLiveChannels(channels),
    videos: []
  };
}
function toStream(record: JsonRecord): KickStream {
  const channel = recordAt(record, "channel") ?? record;
  const user = recordAt(channel, "user") ?? channel;
  const category =
    recordAt(record, "category") ?? firstRecordAt(record, "categories");
  const categoryId = category === null ? "" : identifierAt(category, "id");
  const categoryName = category === null ? "" : stringAt(category, "name");
  return {
    channelAvatar: firstString(user, [
      "profile_pic",
      "profile_picture",
      "avatar"
    ]),
    channelDisplayName: firstString(user, ["username", "name", "slug"]),
    channelId: firstIdentifier(channel, ["id", "slug"]),
    channelName: firstString(channel, ["slug", "username", "name"]),
    id: firstIdentifier(record, ["id", "slug", "session_id"]),
    isLive: booleanAt(record, "is_live") || !hasKey(record, "is_live"),
    language: stringAt(record, "language"),
    platform: "kick",
    startedAt: null,
    tags: stringArrayAt(record, "tags"),
    thumbnailUrl: firstString(record, ["thumbnail_url", "thumbnail", "image"]),
    title: firstString(record, ["session_title", "title", "stream_title"]),
    viewerCount: firstNumber(record, ["viewer_count", "viewers"]),
    ...(categoryId === "" ? {} : { categoryId }),
    ...(categoryName === "" ? {} : { categoryName })
  };
}
function toCategory(record: JsonRecord): KickCategory {
  const viewerCount = firstNumberOrNull(record, ["viewer_count", "viewers"]);
  return {
    boxArtUrl: firstString(record, [
      "thumbnail_url",
      "thumbnail",
      "image",
      "banner_url"
    ]),
    id: firstIdentifier(record, ["id", "slug"]),
    name: stringAt(record, "name"),
    platform: "kick",
    ...(viewerCount === null ? {} : { viewerCount })
  };
}
function toChannel(record: JsonRecord): KickChannel {
  const user = recordAt(record, "user") ?? record;
  return {
    avatarUrl: firstString(user, ["profile_pic", "profile_picture", "avatar"]),
    displayName: firstString(user, ["username", "name", "slug"]),
    id: firstIdentifier(record, ["id", "slug"]),
    isLive: booleanAt(record, "is_live"),
    isPartner: booleanAt(record, "is_partner"),
    isVerified: booleanAt(record, "verified"),
    platform: "kick",
    username: firstString(record, ["slug", "username", "name"])
  };
}
function dataFrom(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}
function cursorFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const pagination = recordAt(value, "pagination");
  const cursor = pagination?.cursor;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 512
    ? cursor
    : null;
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}
function firstRecordAt(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}
function hasKey(record: JsonRecord, key: string): boolean {
  return Object.hasOwn(record, key);
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
function firstIdentifier(record: JsonRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = identifierAt(record, key);
    if (value !== "") return value;
  }
  return "";
}
function firstNumber(record: JsonRecord, keys: readonly string[]): number {
  return firstNumberOrNull(record, keys) ?? 0;
}

function firstNumberOrNull(
  record: JsonRecord,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      return value;
  }
  return null;
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
