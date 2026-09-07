/**
 * Raw Twitch IRC line parser
 *
 * Converts the wire-format strings returned by recent-messages.robotty.de
 * into the parsed-tag shape `parseTwitchMessage` already consumes from tmi.js.
 * This is a wire-format adapter only — message content parsing, badge image
 * resolution, and emote URL generation are still handled by twitch-parser.ts.
 */

import type { TwitchTags } from "./twitch-parser";

export interface ParsedTwitchIrcLine {
  command: "PRIVMSG" | "USERNOTICE";
  /** Channel name without the leading '#'. */
  channel: string;
  /** IRC nick parsed from the source prefix (lowercase), or empty. */
  nick: string;
  /** Parsed tags in the same shape tmi.js gives us. */
  tags: TwitchTags;
  /** Trailing message text. ACTION envelope is stripped; tags["message-type"] = "action" for those. */
  message: string;
}

const BOOL_TAGS = new Set(["mod", "subscriber", "turbo", "first-msg", "returning-chatter"]);
const ACTION_PREFIX = "ACTION ";
const ACTION_SUFFIX = "";

/**
 * Parse a raw IRC line. Returns null for malformed input or commands other
 * than PRIVMSG / USERNOTICE (the only two the seed cares about).
 */
export function parseRawTwitchIrcLine(line: string): ParsedTwitchIrcLine | null {
  const trimmed = line.replace(/[\r\n]+$/, "");
  if (!trimmed) return null;

  let cursor = 0;

  let rawTags = "";
  if (trimmed[cursor] === "@") {
    const sp = trimmed.indexOf(" ", cursor);
    if (sp === -1) return null;
    rawTags = trimmed.slice(1, sp);
    cursor = sp + 1;
  }

  let nick = "";
  if (trimmed[cursor] === ":") {
    const sp = trimmed.indexOf(" ", cursor);
    if (sp === -1) return null;
    const prefix = trimmed.slice(cursor + 1, sp);
    const bang = prefix.indexOf("!");
    nick = (bang === -1 ? prefix : prefix.slice(0, bang)).toLowerCase();
    cursor = sp + 1;
  }

  const cmdSpace = trimmed.indexOf(" ", cursor);
  if (cmdSpace === -1) return null;
  const command = trimmed.slice(cursor, cmdSpace);
  if (command !== "PRIVMSG" && command !== "USERNOTICE") return null;

  const paramsStart = cmdSpace + 1;
  if (trimmed[paramsStart] !== "#") return null;

  const paramSpace = trimmed.indexOf(" ", paramsStart);
  let channel: string;
  let message = "";
  if (paramSpace === -1) {
    channel = trimmed.slice(paramsStart + 1);
  } else {
    channel = trimmed.slice(paramsStart + 1, paramSpace);
    const rest = trimmed.slice(paramSpace + 1);
    message = rest.startsWith(":") ? rest.slice(1) : rest;
  }

  const tags = parseTagString(rawTags);

  // Backfill display-name from the IRC nick when the tag is missing/empty —
  // tmi.js does this for us in the live path, so the parser downstream
  // assumes it's always present.
  if (!tags["display-name"] && nick) {
    tags["display-name"] = nick;
  }

  if (message.startsWith(ACTION_PREFIX) && message.endsWith(ACTION_SUFFIX)) {
    message = message.slice(ACTION_PREFIX.length, -ACTION_SUFFIX.length);
    tags["message-type"] = "action";
  }

  return { command, channel, nick, tags, message };
}

/**
 * Parse an IRCv3 tag string ("k=v;k2=v2;…") into the TwitchTags shape, expanding
 * badges / badge-info / emotes into nested objects and coercing the known
 * boolean tags from "0"/"1".
 */
function parseTagString(raw: string): TwitchTags {
  const tags: TwitchTags = {};
  if (!raw) return tags;

  for (const kv of raw.split(";")) {
    if (!kv) continue;
    const eq = kv.indexOf("=");
    const key = eq === -1 ? kv : kv.slice(0, eq);
    const rawValue = eq === -1 ? "" : kv.slice(eq + 1);
    const value = unescapeTagValue(rawValue);

    if (key === "badges" || key === "badge-info") {
      tags[key] = parseBadgesField(value);
    } else if (key === "emotes") {
      tags.emotes = parseEmotesField(value);
    } else if (BOOL_TAGS.has(key)) {
      tags[key] = value === "1";
    } else {
      tags[key] = value;
    }
  }

  return tags;
}

/**
 * Unescape per IRCv3 message-tags spec: \: → ;, \s → space, \\ → \,
 * \r → CR, \n → LF; unknown escapes drop the backslash and keep the next char;
 * a trailing lone backslash is dropped.
 */
function unescapeTagValue(value: string): string {
  if (!value.includes("\\")) return value;
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    if (i + 1 >= value.length) break;
    const next = value[i + 1];
    switch (next) {
      case ":":
        out += ";";
        break;
      case "s":
        out += " ";
        break;
      case "\\":
        out += "\\";
        break;
      case "r":
        out += "\r";
        break;
      case "n":
        out += "\n";
        break;
      default:
        out += next;
        break;
    }
    i++;
  }
  return out;
}

/** "moderator/1,subscriber/12" → { moderator: "1", subscriber: "12" } */
function parseBadgesField(value: string): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  if (!value) return out;
  for (const pair of value.split(",")) {
    const slash = pair.indexOf("/");
    if (slash === -1) continue;
    out[pair.slice(0, slash)] = pair.slice(slash + 1);
  }
  return out;
}

/** "25:0-4,12-16/1902:18-20" → { "25": ["0-4","12-16"], "1902": ["18-20"] } */
function parseEmotesField(value: string): { [emoteId: string]: string[] } | null {
  if (!value) return null;
  const out: { [emoteId: string]: string[] } = {};
  for (const part of value.split("/")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const emoteId = part.slice(0, colon);
    const positions = part
      .slice(colon + 1)
      .split(",")
      .filter((p) => p.length > 0);
    if (positions.length > 0) out[emoteId] = positions;
  }
  return Object.keys(out).length > 0 ? out : null;
}
