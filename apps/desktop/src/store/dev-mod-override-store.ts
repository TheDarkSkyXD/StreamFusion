/**
 * Dev Mod-Override Store
 *
 * Lets the debug panel force mod-related state so the full pin / unpin /
 * reconnect-dialog UI surface is reachable without an actual mod token.
 *
 *  - `forceModRole`: makes {@link useIsTwitchMod} return true for any channel,
 *    so the hover Pin button renders and the banner switches to the mod
 *    layout (with Unpin instead of Hide).
 *  - `forceModScopes`: makes {@link useRequireModScopes} report
 *    `hasModScopes: true`, so action clicks bypass the reconnect dialog
 *    and reach the GQL mutation directly. (The mutation will still fail
 *    with `unauthenticated` against real Twitch unless the token actually
 *    carries the scopes — useful for end-to-end testing once your token's
 *    upgraded.)
 *
 * Defaults to off — no production impact unless the debug panel flips a flag.
 */

import { create } from "zustand";

interface DevModOverrideState {
  forceModRole: boolean;
  forceModScopes: boolean;
  /**
   * U17 — gates the Whisper button in `UserPopoutFooter`. Twitch heavily
   * rate-limits `user:manage:whispers` for new apps, so the surface is
   * hidden by default until a user opts in via the debug panel.
   */
  showWhisper: boolean;
  /**
   * Dev override for `useResolveTwitchChannel`. When set to a non-empty
   * string, the hook returns this id as the resolved `broadcaster_id`
   * without calling Helix `/users`. Lets the `/mod/twitch/<login>` page
   * mount its broadcaster-id-dependent sections (Banned users,
   * Moderators table, VIPs table, Unban requests, Engagement) without
   * needing a signed-in Twitch session. Cleared by default; setting
   * back to an empty string disables the override.
   */
  forceResolvedTwitchBroadcasterId: string;
  /**
   * Makes every `twitchUser?.id === channelId` style check return true
   * regardless of who's signed in. Unlocks the broadcaster-only
   * sections (Moderators table, VIPs table, Engagement) on
   * `/mod/twitch/<login>` plus the broadcaster Add Mod / Add VIP
   * buttons in `UserPopoutFooter`. Honors the same opt-in shape as
   * `forceModRole` / `forceModScopes`. Off by default.
   */
  forceBroadcasterIdentity: boolean;
  setForceModRole: (v: boolean) => void;
  setForceModScopes: (v: boolean) => void;
  setShowWhisper: (v: boolean) => void;
  setForceResolvedTwitchBroadcasterId: (id: string) => void;
  setForceBroadcasterIdentity: (v: boolean) => void;
  reset: () => void;
}

export const useDevModOverrideStore = create<DevModOverrideState>()((set) => ({
  forceModRole: false,
  forceModScopes: false,
  showWhisper: false,
  forceResolvedTwitchBroadcasterId: "",
  forceBroadcasterIdentity: false,
  setForceModRole: (v) => set({ forceModRole: v }),
  setForceModScopes: (v) => set({ forceModScopes: v }),
  setShowWhisper: (v) => set({ showWhisper: v }),
  setForceResolvedTwitchBroadcasterId: (id) =>
    set({ forceResolvedTwitchBroadcasterId: id }),
  setForceBroadcasterIdentity: (v) => set({ forceBroadcasterIdentity: v }),
  reset: () =>
    set({
      forceModRole: false,
      forceModScopes: false,
      showWhisper: false,
      forceResolvedTwitchBroadcasterId: "",
      forceBroadcasterIdentity: false,
    }),
}));
