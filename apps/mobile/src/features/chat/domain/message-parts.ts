import type { ChatEmote } from "../capabilities/chat-interactions";
import type { WatchChatMessagePart } from "../capabilities/watch-chat";

export function resolveMessageParts(
  text: string,
  emotes: readonly ChatEmote[],
  nativeParts?: readonly WatchChatMessagePart[],
): readonly WatchChatMessagePart[] {
  const catalog = new Map(emotes.map((emote) => [emote.name, emote]));
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
  const parts: WatchChatMessagePart[] = [];
  for (const part of expanded) {
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
