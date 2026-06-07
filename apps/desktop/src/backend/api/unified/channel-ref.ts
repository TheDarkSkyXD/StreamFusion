// Discriminated channel identifier — Twitch login vs numeric id, Kick slug vs numeric id.

export type ChannelRef = { kind: "slug"; value: string } | { kind: "id"; value: string };

export const slugRef = (value: string): ChannelRef => ({ kind: "slug", value });
export const idRef = (value: string): ChannelRef => ({ kind: "id", value });
