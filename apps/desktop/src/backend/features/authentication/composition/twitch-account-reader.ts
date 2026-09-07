import { twitchTransport } from "@backend/api/platforms/twitch/twitch-transport";
import { TwitchAccountReader } from "../adapters/twitch/twitch-account-reader";
export const twitchAccountReader = new TwitchAccountReader(twitchTransport);
