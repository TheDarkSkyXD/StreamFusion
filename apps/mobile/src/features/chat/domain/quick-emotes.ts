import type { Platform } from "@streamfusion/core/platform";
import type {
  ChatEmote,
  ChatEmoteIdentity,
} from "../capabilities/chat-interactions";

const providers: Record<Platform, readonly ChatEmote["provider"][]> = {
  twitch: ["twitch", "7tv", "bttv", "ffz"],
  kick: ["kick", "7tv"],
};

const key = ({ provider, id }: ChatEmoteIdentity) => `${provider}:${id}`;

export function selectQuickEmotes(
  platform: Platform,
  inventory: readonly ChatEmote[],
  recent: readonly ChatEmoteIdentity[],
): readonly ChatEmote[] {
  const available = new Map(inventory.map((emote) => [key(emote), emote]));
  const selected: ChatEmote[] = [];
  const seen = new Set<string>();
  const add = (emote: ChatEmote | undefined) => {
    if (!emote || seen.has(key(emote))) return;
    seen.add(key(emote));
    selected.push(emote);
  };
  for (const identity of recent) {
    if (providers[platform].includes(identity.provider))
      add(available.get(key(identity)));
    if (selected.length === 9) return selected;
  }
  for (const provider of providers[platform]) {
    for (const emote of inventory) {
      if (emote.provider === provider && emote.isGlobal) add(emote);
      if (selected.length === 9) return selected;
    }
  }
  return selected;
}
