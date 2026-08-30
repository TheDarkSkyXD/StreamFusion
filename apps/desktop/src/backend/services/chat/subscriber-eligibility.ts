import { TWITCH_OAUTH_CONFIG } from "@backend/auth/oauth-config";
import { fetchKickUserSubscriptions } from "@backend/services/emotes/kick-user-subscriptions-service";
import { storageService } from "@backend/services/storage-service";
import type { SubscriberEligibilityRequest, SubscriberEligibilityResult } from "@shared/chat-types";

const SUBSCRIPTION_SCOPE = "user:read:subscriptions";
const TWITCH_SUBSCRIPTION_URL = "https://api.twitch.tv/helix/subscriptions/user";

type FetchImpl = typeof fetch;

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function valueMatchesChannel(value: unknown, channel: string, channelId: string | null): boolean {
  const normalized = normalize(value);
  if (!normalized) return false;
  return (
    normalized === normalize(channel) || (channelId !== null && normalized === normalize(channelId))
  );
}

function objectMatchesChannel(
  obj: Record<string, unknown>,
  channel: string,
  channelId: string | null
): boolean {
  const directKeys = [
    "slug",
    "channel_slug",
    "broadcaster_slug",
    "username",
    "name",
    "id",
    "channel_id",
    "broadcaster_user_id",
    "user_id",
  ];

  if (directKeys.some((key) => valueMatchesChannel(obj[key], channel, channelId))) return true;

  for (const nestedKey of ["channel", "broadcaster", "user"]) {
    const nested = obj[nestedKey];
    if (
      nested &&
      typeof nested === "object" &&
      objectMatchesChannel(nested as Record<string, unknown>, channel, channelId)
    ) {
      return true;
    }
  }

  return false;
}

function findSubscriptionList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "subscriptions", "channels", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  return null;
}

export function parseKickSubscriberEligibility(
  payload: unknown,
  request: SubscriberEligibilityRequest
): SubscriberEligibilityResult {
  const subscriptions = findSubscriptionList(payload);
  if (!subscriptions) return { status: "unknown" };

  const isSubscribed = subscriptions.some(
    (item) =>
      item &&
      typeof item === "object" &&
      objectMatchesChannel(item as Record<string, unknown>, request.channel, request.channelId)
  );

  return { status: isSubscribed ? "subscribed" : "notSubscribed" };
}

export async function checkKickSubscriberEligibility(
  request: SubscriberEligibilityRequest
): Promise<SubscriberEligibilityResult> {
  const payload = await fetchKickUserSubscriptions();
  if (payload === null) return { status: "unknown" };
  return parseKickSubscriberEligibility(payload, request);
}

export async function checkTwitchSubscriberEligibility(
  request: SubscriberEligibilityRequest,
  fetchImpl: FetchImpl = fetch
): Promise<SubscriberEligibilityResult> {
  if (!request.channelId) return { status: "unknown" };

  const token = storageService.getToken("twitch");
  if (!token) return { status: "unknown" };

  const scopes = token.scope ?? [];
  if (!scopes.includes(SUBSCRIPTION_SCOPE)) {
    return { status: "missingScopes", missingScopes: [SUBSCRIPTION_SCOPE] };
  }

  const user = storageService.getTwitchUser();
  if (!user?.id) return { status: "unknown" };
  if (user.id === request.channelId) return { status: "subscribed" };

  const url = new URL(TWITCH_SUBSCRIPTION_URL);
  url.searchParams.set("broadcaster_id", request.channelId);
  url.searchParams.set("user_id", user.id);

  const response = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Client-Id": TWITCH_OAUTH_CONFIG.clientId,
    },
  });

  if (response.status === 401 || response.status === 403) {
    return { status: "missingScopes", missingScopes: [SUBSCRIPTION_SCOPE] };
  }

  if (!response.ok) return { status: "unknown" };

  const body = (await response.json()) as { data?: unknown[] };
  return {
    status: Array.isArray(body.data) && body.data.length > 0 ? "subscribed" : "notSubscribed",
  };
}

export async function checkSubscriberEligibility(
  request: SubscriberEligibilityRequest
): Promise<SubscriberEligibilityResult> {
  return request.platform === "kick"
    ? checkKickSubscriberEligibility(request)
    : checkTwitchSubscriberEligibility(request);
}
