import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ChatEmote,
  ChatEmoteReader,
} from "../capabilities/chat-interactions";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";
import { array, identifier, object, string } from "../utils/provider-json";

function https(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

export function parseProviderEmotes(
  provider: ChatEmote["provider"],
  payload: unknown,
): readonly ChatEmote[] {
  const body = object(payload);
  let values: readonly unknown[];
  switch (provider) {
    case "twitch":
      if (!Array.isArray(body.data))
        throw new Error("Invalid Twitch emote inventory.");
      values = array(body.data);
      break;
    case "7tv":
      if (!Array.isArray(body.emotes ?? object(body.emote_set).emotes))
        throw new Error("Invalid 7TV emote inventory.");
      values = array(body.emotes ?? object(body.emote_set).emotes);
      break;
    case "bttv":
      if (
        !Array.isArray(payload) &&
        !Array.isArray(body.channelEmotes) &&
        !Array.isArray(body.sharedEmotes)
      )
        throw new Error("Invalid BTTV emote inventory.");
      values = Array.isArray(payload)
        ? payload
        : [...array(body.channelEmotes), ...array(body.sharedEmotes)];
      break;
    case "ffz":
      if (
        typeof body.sets !== "object" ||
        body.sets === null ||
        Array.isArray(body.sets)
      )
        throw new Error("Invalid FFZ emote inventory.");
      values = Object.values(object(body.sets)).flatMap((set) =>
        array(object(set).emoticons),
      );
      break;
    case "kick":
      if (!Array.isArray(payload) && !Array.isArray(body.emotes))
        throw new Error("Invalid Kick emote inventory.");
      values = Array.isArray(payload)
        ? payload.flatMap((group) => array(object(group).emotes))
        : array(body.emotes);
      break;
  }
  return values.flatMap((raw): ChatEmote[] => {
    const emote = object(raw);
    const id = identifier(emote.id);
    const name = string(emote.name ?? emote.code);
    let imageUrl = "";
    if (provider === "twitch")
      imageUrl =
        string(object(emote.images).url_2x) ||
        `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;
    if (provider === "kick")
      imageUrl = `https://files.kick.com/emotes/${encodeURIComponent(id)}/fullsize`;
    if (provider === "bttv")
      imageUrl = `https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/2x`;
    if (provider === "ffz")
      imageUrl = https(
        string(object(emote.urls)["2"] ?? object(emote.urls)["1"]),
      );
    if (provider === "7tv") {
      const host = object(object(emote.data).host);
      const files = array(host.files).map(object);
      const file =
        files.find((entry) => string(entry.name) === "2x.webp") ??
        files.find((entry) => string(entry.format) === "WEBP");
      if (file) imageUrl = `${https(string(host.url))}/${string(file.name)}`;
    }
    if (!id || !name || !imageUrl.startsWith("https://")) return [];
    return [
      {
        id,
        name,
        imageUrl,
        provider,
        insertion: provider === "kick" ? `[emote:${id}:${name}]` : name,
      },
    ];
  });
}

export function createProviderEmoteReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly access: AuthenticatedPlatformAccess;
}): ChatEmoteReader {
  const readJson = async (
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ) => {
    const response = await input.fetch(url, {
      signal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!response.ok)
      throw new Error(`Emote provider failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  };
  const twitchEmotes = async (
    target: WatchChatConnectInput,
    signal: AbortSignal,
  ): Promise<readonly ChatEmote[]> => {
    const access = await input.access.read("twitch", ["user:read:emotes"]);
    if (access.kind === "blocked") {
      const globalAccess = await input.access.read("twitch");
      if (globalAccess.kind === "blocked") throw new Error(globalAccess.detail);
      return parseProviderEmotes(
        "twitch",
        await readJson(
          "https://api.twitch.tv/helix/chat/emotes/global",
          signal,
          {
            Authorization: `Bearer ${globalAccess.accessToken}`,
            "Client-Id": globalAccess.clientId,
          },
        ),
      );
    }
    const result: ChatEmote[] = [];
    let cursor = "";
    const cursors = new Set<string>();
    do {
      const body = object(
        await readJson(
          `https://api.twitch.tv/helix/chat/emotes/user?user_id=${encodeURIComponent(access.userId)}&broadcaster_id=${encodeURIComponent(target.channelId)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`,
          signal,
          {
            Authorization: `Bearer ${access.accessToken}`,
            "Client-Id": access.clientId,
          },
        ),
      );
      result.push(...parseProviderEmotes("twitch", body));
      cursor = string(object(body.pagination).cursor);
      if (cursors.has(cursor) || result.length >= 3000) break;
      cursors.add(cursor);
    } while (cursor && !signal.aborted);
    return result;
  };
  const sevenTvChannel = async (
    target: WatchChatConnectInput,
    signal: AbortSignal,
  ) => {
    let userId = target.channelId;
    if (target.platform === "kick") {
      const channel = object(
        await readJson(
          `https://kick.com/api/v1/channels/${encodeURIComponent(target.channelName)}`,
          signal,
        ),
      );
      userId = identifier(channel.user_id ?? object(channel.user).id);
      if (!userId)
        throw new Error("Kick did not provide the user ID for 7TV emotes.");
    }
    return parseProviderEmotes(
      "7tv",
      await readJson(
        `https://7tv.io/v3/users/${target.platform.toUpperCase()}/${encodeURIComponent(userId)}`,
        signal,
      ),
    );
  };
  return {
    async read(target, signal) {
      const requests: {
        readonly name: string;
        readonly read: () => Promise<readonly ChatEmote[]>;
      }[] = [
        {
          name: "7TV global",
          read: async () =>
            parseProviderEmotes(
              "7tv",
              await readJson("https://7tv.io/v3/emote-sets/global", signal),
            ),
        },
        {
          name: "7TV channel",
          read: () => sevenTvChannel(target, signal),
        },
      ];
      if (target.platform === "twitch")
        requests.push(
          { name: "Twitch", read: () => twitchEmotes(target, signal) },
          {
            name: "BTTV global",
            read: async () =>
              parseProviderEmotes(
                "bttv",
                await readJson(
                  "https://api.betterttv.net/3/cached/emotes/global",
                  signal,
                ),
              ),
          },
          {
            name: "BTTV channel",
            read: async () =>
              parseProviderEmotes(
                "bttv",
                await readJson(
                  `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(target.channelId)}`,
                  signal,
                ),
              ),
          },
          {
            name: "FFZ global",
            read: async () =>
              parseProviderEmotes(
                "ffz",
                await readJson(
                  "https://api.frankerfacez.com/v1/set/global",
                  signal,
                ),
              ),
          },
          {
            name: "FFZ channel",
            read: async () =>
              parseProviderEmotes(
                "ffz",
                await readJson(
                  `https://api.frankerfacez.com/v1/room/${encodeURIComponent(target.channelName)}`,
                  signal,
                ),
              ),
          },
        );
      else
        requests.push({
          name: "Kick",
          read: async () =>
            parseProviderEmotes(
              "kick",
              await readJson(
                `https://kick.com/emotes/${encodeURIComponent(target.channelName)}`,
                signal,
              ),
            ),
        });
      const results = await Promise.allSettled(
        requests.map((request) => request.read()),
      );
      const emotes = new Map<string, ChatEmote>();
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push(requests[index]?.name ?? "Provider");
          return;
        }
        for (const emote of result.value)
          emotes.set(`${emote.provider}:${emote.id}:${emote.name}`, emote);
      });
      return { emotes: [...emotes.values()].slice(0, 4000), failures };
    },
  };
}
