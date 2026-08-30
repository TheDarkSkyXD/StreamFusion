export interface TwitchChatReplayMessage {
  id: string;
  offsetSeconds: number;
  sender: { id: string; login: string; displayName: string };
  badges: Array<{ id: string; setId: string; version: string }>;
  fragments: Array<
    { type: "text"; text: string } | { type: "emote"; text: string; emoteId: string }
  >;
}

export interface TwitchChatReplayPage {
  capability: "supported";
  videoId: string;
  messages: TwitchChatReplayMessage[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export type TwitchChatReplayResult =
  | TwitchChatReplayPage
  | { capability: "empty"; videoId: string }
  | { capability: "unsupported"; videoId: string; reason: "video-not-found" }
  | { capability: "transient-failure"; videoId: string; reason: string };

export interface TwitchChatReplayRequest {
  videoId: string;
  offsetSeconds?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export type TwitchChatReplayFailureKind =
  "authentication" | "rate-limit" | "transient" | "permanent";

export class TwitchChatReplaySourceError extends Error {
  constructor(
    readonly kind: TwitchChatReplayFailureKind,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(`Twitch Chat Replay request failed: ${status}`);
    this.name = "TwitchChatReplaySourceError";
  }
}

const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const TWITCH_ANONYMOUS_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const VIDEO_COMMENTS_QUERY = `
query VideoCommentsByOffsetOrCursor(
  $videoID: ID!
  $contentOffsetSeconds: Int
  $cursor: Cursor
) {
  video(id: $videoID) {
    id
    comments(after: $cursor, contentOffsetSeconds: $contentOffsetSeconds, first: 100) {
      edges {
        cursor
        node {
          id
          contentOffsetSeconds
          commenter { id login displayName }
          message {
            fragments { text emote { emoteID } }
            userBadges { id setID version }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
}`;

interface TwitchReplayResponse {
  data?: {
    video?: {
      id?: string;
      comments?: {
        edges?: Array<{
          cursor?: string;
          node?: {
            id?: string;
            contentOffsetSeconds?: number;
            commenter?: { id?: string; login?: string; displayName?: string } | null;
            message?: {
              fragments?: Array<{
                text?: string;
                emote?: { emoteID?: string } | null;
              }>;
              userBadges?: Array<{ id?: string; setID?: string; version?: string }>;
            };
          };
        }>;
        pageInfo?: { hasNextPage?: boolean };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export function parseTwitchChatReplayPage(
  response: unknown,
  expectedVideoId: string
): TwitchChatReplayResult {
  const parsedResponse = response as TwitchReplayResponse;
  const video = parsedResponse.data?.video;
  if (video === null) {
    return {
      capability: "unsupported",
      videoId: expectedVideoId,
      reason: "video-not-found",
    };
  }
  const sourceError = parsedResponse.errors?.find((error) => error.message)?.message;
  if (sourceError && !video?.comments) {
    return { capability: "transient-failure", videoId: expectedVideoId, reason: sourceError };
  }
  if (!video || video.id !== expectedVideoId) {
    throw new Error("Twitch Chat Replay response did not match the requested Video");
  }

  const edges = video.comments?.edges ?? [];
  if (edges.length === 0) {
    return { capability: "empty", videoId: video.id };
  }
  const messages = edges.map(({ node }) => {
    const sender = node?.commenter;
    if (
      !node?.id ||
      typeof node.contentOffsetSeconds !== "number" ||
      !sender?.id ||
      !sender.login ||
      !sender.displayName
    ) {
      throw new Error("Twitch Chat Replay response contained an invalid message");
    }
    const fragments = (node.message?.fragments ?? []).map((fragment) => {
      if (typeof fragment.text !== "string") {
        throw new Error("Twitch Chat Replay response contained an invalid content fragment");
      }
      const emoteId = fragment.emote?.emoteID;
      return emoteId
        ? ({ type: "emote", text: fragment.text, emoteId } as const)
        : ({ type: "text", text: fragment.text } as const);
    });
    const badges = (node.message?.userBadges ?? []).map((badge) => {
      if (!badge.id || !badge.setID || !badge.version) {
        throw new Error("Twitch Chat Replay response contained an invalid badge");
      }
      return { id: badge.id, setId: badge.setID, version: badge.version };
    });
    return {
      id: node.id,
      offsetSeconds: node.contentOffsetSeconds,
      sender: { id: sender.id, login: sender.login, displayName: sender.displayName },
      badges,
      fragments,
    };
  });

  return {
    capability: "supported",
    videoId: video.id,
    messages,
    nextCursor: edges.at(-1)?.cursor ?? null,
    hasNextPage: video.comments?.pageInfo?.hasNextPage ?? false,
  };
}

export async function fetchTwitchChatReplayPage(
  request: TwitchChatReplayRequest
): Promise<TwitchChatReplayResult> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(TWITCH_GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_ANONYMOUS_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        operationName: "VideoCommentsByOffsetOrCursor",
        variables: {
          videoID: request.videoId,
          contentOffsetSeconds: request.offsetSeconds,
          cursor: request.cursor,
        },
        query: VIDEO_COMMENTS_QUERY,
      },
    ]),
    signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const kind: TwitchChatReplayFailureKind =
      response.status === 401 || response.status === 403
        ? "authentication"
        : response.status === 429
          ? "rate-limit"
          : response.status >= 500
            ? "transient"
            : "permanent";
    const retryAfter = response.headers.get("Retry-After");
    const parsedRetryAfter = retryAfter === null ? undefined : Number.parseInt(retryAfter, 10);
    throw new TwitchChatReplaySourceError(
      kind,
      response.status,
      Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : undefined
    );
  }
  const body = (await response.json()) as unknown;
  const result = Array.isArray(body) ? body[0] : body;
  return parseTwitchChatReplayPage(result, request.videoId);
}
