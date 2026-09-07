import { TwitchRequestor } from "./twitch-requestor";

/** Shared authenticated Helix transport. Feature adapters own endpoint semantics. */
export const twitchTransport = new TwitchRequestor();
export type TwitchHelixRequestPort = Pick<TwitchRequestor, "request">;
