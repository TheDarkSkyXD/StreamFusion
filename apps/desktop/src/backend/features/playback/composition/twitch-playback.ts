import { twitchTransport } from "@backend/api/platforms/twitch/twitch-transport";
import { TwitchPlayback } from "../adapters/twitch/twitch-playback-reader";
export const twitchPlayback = new TwitchPlayback(twitchTransport);
