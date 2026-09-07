import { twitchTransport } from "@backend/api/platforms/twitch/twitch-transport";
import { TwitchDiscovery } from "../adapters/twitch/twitch-discovery-reader";
export const twitchDiscovery = new TwitchDiscovery(twitchTransport);
