import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ChatEmote,
  ChatEmoteReader,
} from "../capabilities/chat-interactions";
import type { WatchChatConnectInput } from "../capabilities/watch-chat";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
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
    let staticImageUrl: string | undefined;
    let animatedImageUrl: string | undefined;
    let zeroWidth = false;
    if (provider === "twitch") {
      const base = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}`;
      staticImageUrl = `${base}/static/dark/2.0`;
      const animated = array(emote.format).includes("animated");
      animatedImageUrl = animated ? `${base}/animated/dark/2.0` : undefined;
      imageUrl =
        animatedImageUrl ||
        string(object(emote.images).url_2x) ||
        staticImageUrl;
    }
    if (provider === "kick") {
      imageUrl = `https://files.kick.com/emotes/${encodeURIComponent(id)}/fullsize`;
      staticImageUrl = imageUrl;
    }
    if (provider === "bttv") {
      imageUrl = `https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/2x`;
      if (emote.animated === true || emote.imageType === "gif")
        animatedImageUrl = imageUrl;
      else staticImageUrl = imageUrl;
    }
    if (provider === "ffz") {
      const urls = object(emote.urls);
      staticImageUrl = https(string(urls["2"] ?? urls["1"]));
      const animated = object(emote.animated);
      animatedImageUrl =
        https(string(animated["2"] ?? animated["1"])) || undefined;
      imageUrl = animatedImageUrl ?? staticImageUrl;
      zeroWidth = emote.modifier === true;
    }
    if (provider === "7tv") {
      const host = object(object(emote.data).host);
      const files = array(host.files).map(object);
      const file =
        files.find((entry) => string(entry.name) === "2x.webp") ??
        files.find((entry) => string(entry.name) === "2x.avif") ??
        files.find((entry) => string(entry.format).toUpperCase() === "WEBP");
      if (file) {
        imageUrl = `${https(string(host.url))}/${string(file.name)}`;
        const staticName = string(file.static_name);
        if (staticName)
          staticImageUrl = `${https(string(host.url))}/${staticName}`;
        animatedImageUrl =
          object(emote.data).animated === true ? imageUrl : undefined;
      }
      const flags =
        typeof emote.flags === "number"
          ? emote.flags
          : object(emote.data).flags;
      zeroWidth =
        typeof flags === "number" &&
        (flags & (typeof emote.flags === "number" ? 1 : 256)) !== 0;
    }
    if (!id || !name || !imageUrl.startsWith("https://")) return [];
    return [
      {
        id,
        name,
        imageUrl,
        ...(staticImageUrl ? { staticImageUrl } : {}),
        ...(animatedImageUrl ? { animatedImageUrl } : {}),
        ...(zeroWidth ? { zeroWidth } : {}),
        provider,
        insertion: provider === "kick" ? `[emote:${id}:${name}]` : name,
      },
    ];
  });
}

export function createProviderEmoteReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly access: AuthenticatedPlatformAccess;
  readonly display?: Pick<ChatDisplaySettingsSession, "load">;
}): ChatEmoteReader {
  const inventory = new Map<
    string,
    { readonly expiresAt: number; readonly value: Promise<unknown> }
  >();
  const readJson = async (
    url: string,
    signal: AbortSignal,
    headers?: Record<string, string>,
  ) => {
    if (signal.aborted) throw new Error("Emote request cancelled.");
    const load = async (requestSignal: AbortSignal) => {
      const response = await input.fetch(url, {
        signal: requestSignal,
        headers: { Accept: "application/json", ...headers },
      });
      if (!response.ok)
        throw new Error(`Emote provider failed (${response.status}).`);
      return response.json() as Promise<unknown>;
    };
    if (headers) return load(signal);
    const cached = inventory.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const value = load(controller.signal).finally(() => clearTimeout(timeout));
    inventory.set(url, { expiresAt: Date.now() + 10 * 60_000, value });
    void value.catch(() => {
      if (inventory.get(url)?.value === value) inventory.delete(url);
    });
    while (inventory.size > 32)
      inventory.delete(inventory.keys().next().value!);
    return value;
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
      const preferences = (await input.display?.load())?.preferences;
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
      const enabled = requests.filter((request) =>
        request.name.startsWith("7TV")
          ? preferences?.enable7tv !== false
          : request.name.startsWith("BTTV")
            ? preferences?.enableBttv !== false
            : request.name.startsWith("FFZ")
              ? preferences?.enableFfz !== false
              : true,
      );
      const results = await Promise.allSettled(
        enabled.map((request) => request.read()),
      );
      if (signal.aborted) return { emotes: [], failures: [] };
      const emotes = new Map<string, ChatEmote>();
      const failures: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push(enabled[index]?.name ?? "Provider");
          return;
        }
        for (const emote of result.value)
          emotes.set(`${emote.provider}:${emote.id}:${emote.name}`, emote);
      });
      return { emotes: [...emotes.values()].slice(0, 4000), failures };
    },
  };
}
