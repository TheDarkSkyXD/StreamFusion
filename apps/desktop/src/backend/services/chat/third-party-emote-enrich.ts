/**
 * Emote-name substitution for chat-message fragments.
 *
 * Chat servers only know about their own native emote sets — when a viewer
 * types `Clap` (a 7TV emote) or `PepoG` (a BTTV emote), the server broadcasts
 * that as plain text. Without client-side substitution the message renders as
 * the literal name. This helper walks each text fragment, splits it on
 * whitespace, and replaces any token that matches a known emote in the
 * viewer's emote map with an `emote` fragment.
 *
 * Two modes:
 * - **third-party only (default)**: only `7tv` / `bttv` / `ffz` emotes are
 *   substituted. Used for inbound Kick + Twitch messages from other users —
 *   the chat server already encoded native emotes (Kick: `[emote:id:name]`,
 *   Twitch: IRC `emotes` tag) so name-based substitution there would never
 *   trigger anyway.
 * - **include native (opt-in)**: also substitutes `twitch` / `kick` emotes by
 *   name. Used for the Twitch self-echo path — tmi.js fires the synthetic
 *   self-`message` event without emote tags (`skipUpdatingEmotesets` is on),
 *   so even native emote names like `Kappa` arrive as plain text and need
 *   client-side resolution.
 *
 * Substitution can't double-render: when the server stamped emotes properly,
 * the emote text isn't present in any text fragment for the helper to find.
 */

import { ContentFragment } from "@streamfusion/core/chat";
import type { Emote } from "../emotes/emote-types";

const THIRD_PARTY_PROVIDERS = new Set<Emote["provider"]>(["7tv", "bttv", "ffz"]);
const ALL_PROVIDERS = new Set<Emote["provider"]>(["7tv", "bttv", "ffz", "twitch", "kick"]);

/**
 * Substitute emote NAMES inside text fragments with emote fragments, leaving
 * everything else (existing emote / mention / link / cheermote fragments,
 * plain text without matches) untouched.
 *
 * Splitting strategy: whitespace tokenization. Adjacent emotes stay separated
 * by their original spacing — internal whitespace runs are preserved verbatim
 * so messages like `foo  PepoG\tBar` keep their layout when no substitution
 * happens, and only the matched token is swapped out.
 *
 * @param fragments  Parsed message fragments straight off the parser.
 * @param emoteByName  Lookup of emote NAME → Emote record. Built once per
 *   channel from `emoteStore.getAllEmotes()`. When empty (e.g. before the
 *   emote sets have loaded) this returns the input unchanged.
 * @param opts.includeNative  When true, also substitutes native (twitch /
 *   kick) emote names. Default false — used for Twitch self-echoes where
 *   tmi.js delivers the synthetic event without emote tags.
 */
export function substituteThirdPartyEmotes(
  fragments: ContentFragment[],
  emoteByName: Map<string, Emote>,
  opts: { includeNative?: boolean } = {}
): ContentFragment[] {
  if (emoteByName.size === 0 || fragments.length === 0) return fragments;

  const allowed = opts.includeNative ? ALL_PROVIDERS : THIRD_PARTY_PROVIDERS;
  const out: ContentFragment[] = [];
  let mutated = false;

  for (const fragment of fragments) {
    if (fragment.type !== "text") {
      out.push(fragment);
      continue;
    }

    // /(\s+)/ keeps separators so we can stitch the text back together
    // verbatim around any substituted tokens.
    const tokens = fragment.content.split(/(\s+)/);
    let textBuf = "";
    const fragOut: ContentFragment[] = [];

    const flushText = () => {
      if (textBuf.length === 0) return;
      fragOut.push({ type: "text", content: textBuf });
      textBuf = "";
    };

    for (const token of tokens) {
      if (token.length === 0) continue;
      if (/^\s+$/.test(token)) {
        textBuf += token;
        continue;
      }
      const emote = emoteByName.get(token);
      if (!emote || !allowed.has(emote.provider)) {
        textBuf += token;
        continue;
      }
      flushText();
      fragOut.push({
        type: "emote",
        id: emote.id,
        name: emote.name,
        url: emote.urls.url2x ?? emote.urls.url1x,
        provider: emote.provider,
        width: emote.width,
        height: emote.height,
        url1x: emote.urls.url1x,
        url2x: emote.urls.url2x,
        url4x: emote.urls.url4x,
        isAnimated: emote.isAnimated,
        isZeroWidth: emote.isZeroWidth,
      });
      mutated = true;
    }
    flushText();

    if (fragOut.length === 0) {
      // Defensive: shouldn't happen (text always flushes something), but keeps
      // the empty-text edge from collapsing the fragment list.
      out.push(fragment);
    } else if (
      fragOut.length === 1 &&
      fragOut[0].type === "text" &&
      fragOut[0].content === fragment.content
    ) {
      out.push(fragment);
    } else {
      out.push(...fragOut);
    }
  }

  return mutated ? out : fragments;
}
