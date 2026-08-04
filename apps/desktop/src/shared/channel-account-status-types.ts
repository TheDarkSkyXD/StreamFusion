/**
 * Provider-authoritative account availability exposed across the IPC boundary.
 * Live/offline remains a separate stream-presence concern on UnifiedChannel.
 */
export type ChannelAccountStatus = "active" | "suspended" | "unavailable";
