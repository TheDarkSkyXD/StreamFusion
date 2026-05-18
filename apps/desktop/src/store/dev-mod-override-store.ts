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
  setForceModRole: (v: boolean) => void;
  setForceModScopes: (v: boolean) => void;
  setShowWhisper: (v: boolean) => void;
  reset: () => void;
}

export const useDevModOverrideStore = create<DevModOverrideState>()((set) => ({
  forceModRole: false,
  forceModScopes: false,
  showWhisper: false,
  setForceModRole: (v) => set({ forceModRole: v }),
  setForceModScopes: (v) => set({ forceModScopes: v }),
  setShowWhisper: (v) => set({ showWhisper: v }),
  reset: () => set({ forceModRole: false, forceModScopes: false, showWhisper: false }),
}));
