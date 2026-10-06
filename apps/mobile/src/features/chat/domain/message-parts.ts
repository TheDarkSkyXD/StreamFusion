import type { ChatEmote } from "../capabilities/chat-interactions";
import type { WatchChatMessagePart } from "../capabilities/watch-chat";

const catalogs = new WeakMap<
  readonly ChatEmote[],
  ReadonlyMap<string, ChatEmote>
>();

function emoteCatalog(
  emotes: readonly ChatEmote[],
): ReadonlyMap<string, ChatEmote> {
  const cached = catalogs.get(emotes);
  if (cached) return cached;
  const catalog = new Map(emotes.map((emote) => [emote.name, emote]));
  catalogs.set(emotes, catalog);
  return catalog;
}

type EmotePart = Extract<WatchChatMessagePart, { kind: "emote" }>;
export type RenderChatMessagePart =
  | WatchChatMessagePart
  | { readonly kind: "emote-stack"; readonly emotes: readonly EmotePart[] };

export function resolveMessageParts(
  text: string,
  emotes: readonly ChatEmote[],
  nativeParts?: readonly WatchChatMessagePart[],
  options: {
    readonly animatedEmotes?: boolean;
    readonly overlayEmotes?: boolean;
    readonly renderEmotesAsText?: boolean;
  } = {},
): readonly RenderChatMessagePart[] {
  const catalog = emoteCatalog(emotes);
  const source: readonly WatchChatMessagePart[] = nativeParts ?? [
    { kind: "text", text },
  ];
  const expanded = source.flatMap((part): WatchChatMessagePart[] => {
    if (part.kind === "emote") return [part];
    return part.text
      .split(/(\[emote:\d+:[^\]]+\]|\s+)/)
      .filter(Boolean)
      .map((word) => {
        const kick = /^\[emote:(\d+):([^\]]+)]$/.exec(word);
        if (kick)
          return {
            kind: "emote",
            text: kick[2] ?? word,
            imageUrl: `https://files.kick.com/emotes/${kick[1]}/fullsize`,
          };
        const emote = catalog.get(word);
        return emote
          ? { kind: "emote", text: emote.name, imageUrl: emote.imageUrl }
          : { kind: "text", text: word };
      });
  });
  const parts: RenderChatMessagePart[] = [];
  for (const original of expanded) {
    const candidate =
      original.kind === "emote" ? catalog.get(original.text) : undefined;
    const emote =
      original.kind === "emote" && candidate?.imageUrl === original.imageUrl
        ? candidate
        : undefined;
    const part: WatchChatMessagePart =
      original.kind === "emote"
        ? options.renderEmotesAsText
          ? { kind: "text", text: original.text }
          : {
              ...original,
              imageUrl:
                options.animatedEmotes === false
                  ? (emote?.staticImageUrl ??
                    original.imageUrl.replace("/default/", "/static/"))
                  : (emote?.animatedImageUrl ?? original.imageUrl),
            }
        : original;
    if (
      part.kind === "emote" &&
      emote?.zeroWidth &&
      options.overlayEmotes !== false
    ) {
      const trailing = parts.at(-1);
      const base =
        trailing?.kind === "text" && !trailing.text.trim()
          ? parts.at(-2)
          : trailing;
      if (base?.kind === "emote" || base?.kind === "emote-stack") {
        if (trailing !== base) parts.pop();
        parts[parts.length - 1] = {
          kind: "emote-stack",
          emotes: [...(base.kind === "emote" ? [base] : base.emotes), part],
        };
        continue;
      }
    }
    const previous = parts.at(-1);
    if (part.kind === "text" && previous?.kind === "text") {
      parts[parts.length - 1] = {
        kind: "text",
        text: previous.text + part.text,
      };
    } else {
      parts.push(part);
    }
  }
  return parts;
}

export function twitchEmoteParts(
  text: string,
  tag: string,
): readonly WatchChatMessagePart[] | undefined {
  if (!tag) return undefined;
  const characters = Array.from(text);
  const ranges = tag
    .split("/")
    .flatMap((group) => {
      const [id, offsets] = group.split(":");
      if (!id || !offsets) return [];
      return offsets.split(",").flatMap((range) => {
        const [start, end] = range.split("-").map(Number);
        if (
          start === undefined ||
          end === undefined ||
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          end >= characters.length
        )
          return [];
        return [{ id, start, end }];
      });
    })
    .sort((left, right) => left.start - right.start);
  const parts: WatchChatMessagePart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor)
      parts.push({
        kind: "text",
        text: characters.slice(cursor, range.start).join(""),
      });
    parts.push({
      kind: "emote",
      text: characters.slice(range.start, range.end + 1).join(""),
      imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(range.id)}/default/dark/2.0`,
    });
    cursor = range.end + 1;
  }
  if (cursor < characters.length)
    parts.push({ kind: "text", text: characters.slice(cursor).join("") });
  return parts;
}
