/**
 * Twitch Pinned-Message Poller
 *
 * Twitch does not expose pinned-chat-message events on its public IRC stream
 * the way Kick exposes them on Pusher — at least not as documented `msg-id`
 * values we could reliably parse. So we poll Twitch's GraphQL endpoint for
 * the channel's current pin every {@link POLL_INTERVAL_MS}, diff against the
 * previous snapshot, and emit normalized `pinnedMessage` / `pinnedMessageCleared`
 * events through {@link twitchChatService} — the same surface Kick uses.
 *
 * One query fetches everything in a single round-trip:
 *
 *   channel(name: $login) {
 *     pinnedChatMessages {
 *       edges {
 *         node {
 *           id            # pin record id (NOT the chat message id)
 *           type          # MOD | ...
 *           updatedAt
 *           startsAt      # when the timed pin began
 *           endsAt        # when the timed pin expires
 *           pinnedBy { login displayName chatColor }
 *           pinnedMessage {
 *             id          # the actual chat message id
 *             sender { login displayName chatColor }
 *             content { text fragments { text content { __typename } } }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Schema verified against gql.twitch.tv on 2026-05-18 with live pins on
 * channels darkskyfullofstars (pin id 78bf3377-…, message id 11a6530f-…)
 * and fitzbro (pin id 8fee27eb-…, message id 37be039a-…). Anonymous
 * Android-app Client-Id (kd1unb4b3q4t58fwlpcbzcbnm76a8fp) works without
 * an Authorization header.
 *
 * Change detection includes the chat message id plus timing fields. Twitch can
 * update duration metadata on the same pinned message, and the banner must
 * refresh so the native-style progress bar can appear.
 */

// Cross-logger: imported by TwitchChat (renderer) — avoids dragging
// electron-log into the renderer bundle.
import { logger } from "@shared/utils/cross-logger";
import { createManagedInterval } from "@shared/utils/managed-interval";
import type {
  ChatBadge,
  ContentFragment,
  NormalizedPinnedMessage,
} from "../../../shared/chat-types";
import { twitchChatService } from "./twitch-chat";

// Twitch's chat-message fragments come back as plain text — twitch.tv parses
// URLs client-side at render time. We mirror that here so the pin banner can
// render real <a> tags instead of inert text. Same regex shape as
// twitch-parser.ts uses for live chat URL detection.
const URL_REGEX = /https?:\/\/[^\s]+/g;

function parseTextForLinks(text: string): ContentFragment[] {
  if (!text) return [];
  const fragments: ContentFragment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      fragments.push({ type: "text", content: text.slice(lastIndex, start) });
    }
    fragments.push({ type: "link", url, text: url });
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) {
    fragments.push({ type: "text", content: text.slice(lastIndex) });
  }
  // If no URLs matched at all, emit a single text fragment so callers can
  // rely on a non-empty array for non-empty input.
  if (fragments.length === 0) fragments.push({ type: "text", content: text });
  return fragments;
}

function getTwitchEmoteUrl(emoteId: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/3.0`;
}

const GQL_ENDPOINT = "https://gql.twitch.tv/gql";
// Anonymous Android-app Client-Id — same one used elsewhere in twitch-gql-client.ts.
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface GqlBadge {
  setID: string;
  version: string;
  title: string;
  imageURL: string;
}

interface PinnedChatMessageNode {
  id: string;
  type: string | null;
  updatedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  pinnedBy: {
    id?: string;
    login: string;
    displayName: string;
    chatColor: string | null;
    displayBadges: GqlBadge[] | null;
  } | null;
  pinnedMessage: {
    id: string;
    sentAt: string | null;
    sender: {
      id?: string;
      login: string;
      displayName: string;
      chatColor: string | null;
      displayBadges: GqlBadge[] | null;
    } | null;
    content: {
      text: string;
      fragments: Array<{
        text: string;
        content: {
          __typename?: string;
          id?: string;
          token?: string;
          assetType?: string;
        } | null;
      }> | null;
    } | null;
  } | null;
}

type PinnedMessageContent = NonNullable<PinnedChatMessageNode["pinnedMessage"]>["content"];

interface PollState {
  /** Channel login (e.g. "fitzbro") this poller targets. */
  login: string;
  /** Active interval timer. */
  timer: { stop: () => void };
  /** Last seen pin signature. Used for change detection. */
  lastPinSignature: string;
  /** Set once the poller has completed its first poll, so callers can tell
   *  "no pin" apart from "haven't polled yet". */
  bootstrapped: boolean;
}

type TwitchPinnedMessageBridge = (params: {
  channel: string;
}) => Promise<{ success: boolean; data?: unknown | null; error?: string }>;

const pollers = new Map<string, PollState>();

function getTwitchPinnedMessageBridge(): TwitchPinnedMessageBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as Window & {
        electronAPI?: {
          chat?: {
            getTwitchPinnedMessage?: TwitchPinnedMessageBridge;
          };
        };
      }
    ).electronAPI?.chat?.getTwitchPinnedMessage ?? null
  );
}

/** Start polling a channel's pinned message. Safe to call repeatedly for the
 *  same channel — duplicate calls are ignored. */
export function startTwitchPinPolling(channelLogin: string): void {
  const login = channelLogin.toLowerCase();
  if (pollers.has(login)) return;

  const state: PollState = {
    login,
    timer: createManagedInterval(() => void poll(login), POLL_INTERVAL_MS),
    lastPinSignature: "",
    bootstrapped: false,
  };
  pollers.set(login, state);
  // Fire one poll immediately so the banner shows up on mount, not 10s later.
  void poll(login);
}

/** Stop polling and clear state for a channel. */
export function stopTwitchPinPolling(channelLogin: string): void {
  const login = channelLogin.toLowerCase();
  const state = pollers.get(login);
  if (!state) return;
  state.timer.stop();
  pollers.delete(login);
}

/** Test/debug helper — drop all pollers (used between test cases). */
export function __resetTwitchPinPollers(): void {
  for (const state of pollers.values()) state.timer.stop();
  pollers.clear();
}

async function poll(login: string): Promise<void> {
  const state = pollers.get(login);
  if (!state) return;

  let pin: PinnedChatMessageNode | null;
  try {
    pin = await fetchActivePin(login);
  } catch (error) {
    // Network blip / Twitch hiccup — silent skip; try again on the next tick.
    if (process.env.NODE_ENV !== "production") {
      logger.debug("Chat:Pin", "Fetch failed", {
        login,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
    return;
  }

  state.bootstrapped = true;
  const currentPinSignature = getPinSignature(pin);
  if (currentPinSignature === state.lastPinSignature) return;
  state.lastPinSignature = currentPinSignature;

  if (!pin) {
    twitchChatService.emit("pinnedMessageCleared");
    return;
  }

  twitchChatService.emit("pinnedMessage", toNormalized(pin, login));
}

function getPinSignature(pin: PinnedChatMessageNode | null): string {
  if (!pin) return "";
  return [
    pin.pinnedMessage?.id ?? "",
    pin.id,
    pin.updatedAt ?? "",
    pin.startsAt ?? "",
    pin.endsAt ?? "",
  ].join("|");
}

function hasTimingFields(pin: Partial<PinnedChatMessageNode> | null): boolean {
  if (!pin) return true;
  return "startsAt" in pin && "endsAt" in pin;
}

async function fetchActivePin(login: string): Promise<PinnedChatMessageNode | null> {
  const bridgedFetch = getTwitchPinnedMessageBridge();
  if (bridgedFetch) {
    const result = await bridgedFetch({ channel: login });
    if (!result.success) {
      throw new Error(result.error || "Failed to fetch Twitch pinned message");
    }
    const bridgedPin = (result.data ?? null) as Partial<PinnedChatMessageNode> | null;
    if (hasTimingFields(bridgedPin)) return bridgedPin as PinnedChatMessageNode | null;

    if (process.env.NODE_ENV !== "production") {
      logger.debug("Chat:Pin", "Bridge pin payload missing timing fields; using direct GQL", {
        login,
        pinId: bridgedPin?.id,
      });
    }
  }

  return fetchActivePinDirect(login);
}

async function fetchActivePinDirect(login: string): Promise<PinnedChatMessageNode | null> {
  const data = await gqlRequest<{
    channel: { pinnedChatMessages: { edges: Array<{ node: PinnedChatMessageNode }> } } | null;
  }>({
    operationName: "PinnedMessagesByChannel",
    variables: { login },
    query: `query PinnedMessagesByChannel($login: String!) {
      channel(name: $login) {
        pinnedChatMessages {
          edges {
            node {
              id
              type
              updatedAt
              startsAt
              endsAt
              pinnedBy {
                id
                login
                displayName
                chatColor
                displayBadges(channelLogin: $login) { setID version title imageURL }
              }
              pinnedMessage {
                id
                sentAt
                sender {
                  id
                  login
                  displayName
                  chatColor
                  displayBadges(channelLogin: $login) { setID version title imageURL }
                }
                content {
                  text
                  fragments {
                    text
                    content { __typename ... on Emote { id token assetType } }
                  }
                }
              }
            }
          }
        }
      }
    }`,
  });

  const edge = data?.channel?.pinnedChatMessages?.edges?.[0];
  return edge?.node ?? null;
}

async function gqlRequest<T>(op: {
  operationName: string;
  variables: Record<string, unknown>;
  query: string;
}): Promise<T | null> {
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: { "Client-Id": GQL_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify(op),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gql ${op.operationName} ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`gql ${op.operationName} errors`);
  return json.data ?? null;
}

/**
 * Build the normalized payload from the raw GraphQL response.
 *
 * `pinnedMessage` carries the chat message body and sender. When it's null
 * (a possible-but-rare schema state — e.g. the underlying message was
 * deleted while the pin is still active), we fall back to pinnedBy as the
 * author and emit empty content so the banner can still render the
 * "Pinned by X" header.
 *
 * Badges (Broadcaster, Subscriber, Verified, Mod, VIP, etc.) come from
 * `displayBadges(channelLogin:)` returned per User in the same GQL query,
 * which is Twitch's canonical badge-lookup field. We map directly — no
 * hardcoded fallbacks needed.
 *
 * `channelLogin` is currently unused for normalization but kept on the
 * signature for future logic that may need to compare pinnedBy vs channel.
 *
 * Exported for testing.
 */
function gqlBadgesToChatBadges(gqlBadges: GqlBadge[] | null | undefined): ChatBadge[] {
  if (!gqlBadges) return [];
  return gqlBadges.map((b) => ({
    setId: b.setID,
    version: b.version,
    imageUrl: b.imageURL,
    title: b.title,
  }));
}

function parsePinnedMessageContent(content: PinnedMessageContent): ContentFragment[] {
  if (!content) return [];

  const fragments = content.fragments ?? [];
  const hasRichEmoteFragments = fragments.some(
    (fragment) => fragment.content?.__typename === "Emote" && !!fragment.content.id
  );

  if (!hasRichEmoteFragments) {
    const fragmentText = fragments.map((fragment) => fragment.text).join("");
    const text = content.text || fragmentText;
    return text ? parseTextForLinks(text) : [];
  }

  const out: ContentFragment[] = [];
  for (const fragment of fragments) {
    const emote = fragment.content;
    if (emote?.__typename === "Emote" && emote.id) {
      out.push({
        type: "emote",
        id: emote.id,
        name: emote.token || fragment.text,
        url: getTwitchEmoteUrl(emote.id),
        isAnimated: emote.assetType === "ANIMATED",
        isZeroWidth: false,
      });
      continue;
    }

    out.push(...parseTextForLinks(fragment.text));
  }

  return out;
}

export function toNormalized(
  pin: PinnedChatMessageNode,

  channelLogin?: string
): NormalizedPinnedMessage {
  const inner = pin.pinnedMessage;

  const author = inner?.sender
    ? {
        ...(inner.sender.id ? { userId: inner.sender.id } : {}),
        username: inner.sender.login,
        displayName: inner.sender.displayName,
        color: inner.sender.chatColor ?? "#9146FF",
        badges: gqlBadgesToChatBadges(inner.sender.displayBadges),
      }
    : pin.pinnedBy
      ? {
          ...(pin.pinnedBy.id ? { userId: pin.pinnedBy.id } : {}),
          username: pin.pinnedBy.login,
          displayName: pin.pinnedBy.displayName,
          color: pin.pinnedBy.chatColor ?? "#9146FF",
          badges: gqlBadgesToChatBadges(pin.pinnedBy.displayBadges),
        }
      : { username: "unknown", displayName: "Unknown", color: "#9146FF", badges: [] };

  return {
    platform: "twitch",
    // The chat message id (inner) is the right messageId for unpin targeting
    // and optimistic reconciliation. Fall back to the pin record id only if
    // the nested message is somehow absent.
    messageId: inner?.id ?? pin.id,
    pinRecordId: pin.id,
    author,
    content: parsePinnedMessageContent(inner?.content ?? null),
    pinnedBy: pin.pinnedBy
      ? {
          ...(pin.pinnedBy.id ? { userId: pin.pinnedBy.id } : {}),
          username: pin.pinnedBy.login,
          displayName: pin.pinnedBy.displayName,
          color: pin.pinnedBy.chatColor ?? "#9146FF",
          badges: gqlBadgesToChatBadges(pin.pinnedBy.displayBadges),
        }
      : null,
    pinnedAt: pin.startsAt ?? pin.updatedAt ?? new Date().toISOString(),
    sentAt: inner?.sentAt ?? null,
    expiresAt: pin.endsAt ?? null,
  };
}
