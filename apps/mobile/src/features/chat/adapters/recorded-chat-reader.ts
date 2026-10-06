import type {
  ChatReplayReader,
  WatchChatMessage,
  WatchChatMessagePart,
} from "../capabilities/watch-chat";
import { resolveTwitchBadges } from "../domain/twitch-global-badge-catalog";
import { parseKickIdentityBadges } from "../domain/kick-chat-badges";
import { array, identifier, object, string } from "../utils/provider-json";
import { getBundledBadgeUrl } from "../utils/kick-badge-assets";

const QUERY = `query VideoCommentsByOffsetOrCursor($videoID: ID!, $contentOffsetSeconds: Int, $cursor: Cursor) {
  video(id: $videoID) { id comments(after: $cursor, contentOffsetSeconds: $contentOffsetSeconds, first: 100) {
    edges { cursor node { id contentOffsetSeconds commenter { id login displayName }
      message { fragments { text emote { emoteID } } userBadges { id setID version } } } }
    pageInfo { hasNextPage }
  } }
}`;

export function createRecordedChatReader(
  fetch: typeof globalThis.fetch,
): ChatReplayReader {
  const kickLocators = new Map<
    string,
    { readonly channelId: string; readonly startedAt: number }
  >();
  const readJson = async (
    url: string,
    signal: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> => {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok)
      throw new Error(`Recorded chat request failed (${response.status}).`);
    return response.json();
  };
  return {
    async read(target, offsetSeconds, cursor, signal) {
      const media = target.media;
      if (!media || media.kind === "clip")
        return {
          kind: "unavailable",
          detail: "This clip has no recorded comment timeline.",
        };
      if (target.platform === "twitch") {
        const raw = await readJson("https://gql.twitch.tv/gql", signal, {
          method: "POST",
          headers: {
            "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              operationName: "VideoCommentsByOffsetOrCursor",
              query: QUERY,
              variables: {
                videoID: media.id,
                ...(cursor
                  ? { cursor }
                  : { contentOffsetSeconds: Math.floor(offsetSeconds) }),
              },
            },
          ]),
        });
        const body = object(Array.isArray(raw) ? raw[0] : raw);
        const data = object(body.data);
        if (data.video === null)
          return {
            kind: "unavailable",
            detail: "This video is no longer available.",
          };
        const video = object(data.video);
        const comments = object(video.comments);
        if (
          array(body.errors).length ||
          string(video.id) !== media.id ||
          !Array.isArray(comments.edges)
        )
          throw new Error("Twitch recorded comments returned an invalid page.");
        const edges = array(comments.edges).map(object);
        const messages = edges.map((edge): WatchChatMessage => {
          const node = object(edge.node);
          const sender = object(node.commenter);
          const message = object(node.message);
          if (
            !string(node.id) ||
            typeof node.contentOffsetSeconds !== "number" ||
            !Number.isFinite(node.contentOffsetSeconds) ||
            !string(sender.login)
          )
            throw new Error(
              "Twitch recorded comments returned an invalid message.",
            );
          const parts = array(message.fragments).map(
            (raw): WatchChatMessagePart => {
              const fragment = object(raw);
              if (typeof fragment.text !== "string")
                throw new Error("Invalid recorded message fragment.");
              const id = string(object(fragment.emote).emoteID);
              return id
                ? {
                    kind: "emote",
                    text: fragment.text,
                    imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`,
                  }
                : { kind: "text", text: fragment.text };
            },
          );
          return {
            id: string(node.id),
            userId: string(sender.id),
            username: string(sender.login),
            displayName: string(sender.displayName) || string(sender.login),
            offsetSeconds: node.contentOffsetSeconds,
            text: parts.map((part) => part.text).join(""),
            parts,
            badges: resolveTwitchBadges(
              array(message.userBadges).map((badge) => ({
                setId: string(object(badge).setID),
                version: string(object(badge).version),
              })),
            ),
          };
        });
        const next =
          object(comments.pageInfo).hasNextPage === true
            ? string(edges.at(-1)?.cursor)
            : "";
        if (object(comments.pageInfo).hasNextPage === true && !next)
          throw new Error("Twitch recorded comments omitted the next cursor.");
        return { kind: "page", messages, cursor: next || null };
      }
      let locator = kickLocators.get(media.id);
      if (!locator) {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(media.id))
          return {
            kind: "unavailable",
            detail: "Kick replay needs the video's recording identifier.",
          };
        const metadata = object(
          await readJson(
            `https://kick.com/api/v1/video/${encodeURIComponent(media.id)}`,
            signal,
            { headers: { Accept: "application/json" } },
          ),
        );
        const live = object(metadata.livestream);
        const channelId = identifier(
          object(metadata.channel).id ??
            object(live.channel).id ??
            live.channel_id ??
            metadata.channel_id,
        );
        const startedAt = Date.parse(
          string(
            metadata.start_time ??
              live.start_time ??
              live.created_at ??
              metadata.created_at,
          ),
        );
        if (!channelId || !Number.isFinite(startedAt))
          return {
            kind: "unavailable",
            detail: "Kick did not provide this video's recorded timeline.",
          };
        locator = { channelId, startedAt };
        if (kickLocators.size >= 32) {
          const first = kickLocators.keys().next().value;
          if (first) kickLocators.delete(first);
        }
        kickLocators.set(media.id, locator);
      }
      const query = cursor
        ? `cursor=${encodeURIComponent(cursor)}`
        : `start_time=${encodeURIComponent(new Date(locator.startedAt + offsetSeconds * 1000).toISOString())}`;
      const body = object(
        await readJson(
          `https://web.kick.com/api/v1/chat/${encodeURIComponent(locator.channelId)}/history?${query}`,
          signal,
          { headers: { Accept: "application/json", "X-App-Platform": "web" } },
        ),
      );
      const data = object(body.data);
      if (!Array.isArray(data.messages))
        throw new Error(
          "Kick recorded comments returned an invalid history page.",
        );
      const startedAt = locator.startedAt;
      const messages = array(data.messages).map((raw): WatchChatMessage => {
        const message = object(raw);
        const sender = object(message.sender);
        const identity = object(sender.identity);
        const timestamp = Date.parse(string(message.created_at));
        if (
          !identifier(message.id) ||
          typeof message.content !== "string" ||
          !string(sender.slug) ||
          !Number.isFinite(timestamp)
        )
          throw new Error(
            "Kick recorded comments returned an invalid message.",
          );
        return {
          id: identifier(message.id),
          userId: identifier(sender.id ?? message.user_id),
          displayName: string(sender.username) || string(sender.slug),
          username: string(sender.slug),
          text: message.content,
          offsetSeconds: Math.max(0, (timestamp - startedAt) / 1000),
          badges: parseKickIdentityBadges(
            identity.badges ?? sender.badges,
            getBundledBadgeUrl,
          ),
          ...(string(identity.color) ? { color: string(identity.color) } : {}),
        };
      });
      return { kind: "page", messages, cursor: string(data.cursor) || null };
    },
  };
}
